'use client';

/**
 * Globe3D — a real 3D earth for the homepage hero.
 *
 * Deliberately dependency-free raw WebGL2 rather than three.js:
 *   - three + @types/three is ~160 KB gzip for one textured sphere;
 *   - installing it from the device bridge was impossible (that VM is disk-full,
 *     cannot delete files so npm's rename step fails, and is linux/arm64 — it
 *     would have written Linux binaries into a macOS node_modules);
 *   - the whole scene is one ray-traced sphere, which is ~100 lines of GLSL.
 *
 * The sphere is NOT polygonal geometry. The fragment shader intersects a ray
 * with a unit sphere analytically, so the silhouette is exact at any DPR and
 * there is no index/vertex buffer to manage. Everything is one draw call of a
 * single full-screen triangle.
 *
 * The texture (public/globe/earth-color.webp) is generated from Natural Earth
 * vector data (world-atlas, public domain) by scripts/build-globe-texture —
 * it is our own raster, not a third-party image.
 *
 * Degradation, in order:
 *   no WebGL2            -> static <img> of the same texture
 *   texture fails        -> static <img>
 *   prefers-reduced-motion -> renders one frame, no auto-rotation, drag still works
 *   scrolled out of view -> render loop stops (IntersectionObserver)
 */

import { useEffect, useRef, useState } from 'react';

export interface GlobeMarker {
  /** degrees, -90..90 */
  lat: number;
  /** degrees, -180..180 */
  lon: number;
  /** css-ish rgb triplet 0..1 */
  color?: [number, number, number];
}

const MAX_MARKERS = 24;
const TEXTURE_URL = '/globe/earth-color.webp';

/**
 * lat/lon (degrees) -> unit vector in globe space (+X at lon 0, +Y at north pole).
 *
 * z is NEGATED on purpose. With +z the frame is left-handed against a camera
 * sitting on +z, and the whole globe renders mirrored (the Americas end up east
 * of the Atlantic). The shader's inverse mapping uses atan(-z, x) to match.
 */
function toUnitVector(lat: number, lon: number): [number, number, number] {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const c = Math.cos(phi);
  return [c * Math.cos(lambda), Math.sin(phi), -c * Math.sin(lambda)];
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

out vec4 outColor;

uniform sampler2D uTex;
uniform vec2  uRes;
uniform float uTime;
uniform float uYaw;
uniform float uTilt;
uniform int   uMarkerCount;
uniform int   uActive;
uniform vec3  uMarkerPos[${MAX_MARKERS}];
uniform vec3  uMarkerCol[${MAX_MARKERS}];

const float PI     = 3.14159265359;
const float CAM_Z  = 2.75;
// Silhouette half-angle is asin(1/CAM_Z) -> tan = 0.389, so the fov must be
// wider than that or the sphere is clipped by the viewport.
const float TAN_FOV = 0.50;

mat3 rotY(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, 0.0, -s,  0.0, 1.0, 0.0,  s, 0.0, c);
}
mat3 rotX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0,  0.0, c, s,  0.0, -s, c);
}

void main() {
  // Fit by the SHORTER axis so the globe is never clipped on narrow viewports.
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) * 2.0;

  vec3 ro = vec3(0.0, 0.0, CAM_Z);
  vec3 rd = normalize(vec3(p * TAN_FOV, -1.0));

  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;

  // Perpendicular distance from the sphere centre to the ray; drives the halo.
  float perp = sqrt(max(dot(ro, ro) - b * b, 0.0));

  vec3  col   = vec3(0.0);
  float alpha = 0.0;

  // --- atmosphere halo, OUTSIDE the silhouette only ------------------------
  // Without the step() this also fires for perp < 1 and adds a flat blue wash
  // over the whole disc, which destroys the land/ocean contrast.
  // The exponential alone is still ~6% alpha where the canvas ends, which
  // shows up as a faint rectangle around the globe on a dark page. The
  // smoothstep drives it to zero before the edge so the canvas has no visible
  // bounding box at any aspect ratio.
  float halo = step(1.0, perp) * exp(-(perp - 1.0) * 14.0) * smoothstep(1.30, 1.05, perp);
  col   += vec3(0.12, 0.44, 0.98) * halo * 0.70;
  alpha += halo * 0.70;

  if (h > 0.0) {
    float t = -b - sqrt(h);
    vec3  pos = ro + rd * t;
    vec3  n   = normalize(pos);                 // world-space normal

    // Undo the globe's rotation to land in texture space.
    vec3 ng = rotY(-uYaw) * rotX(-uTilt) * n;

    float u = atan(-ng.z, ng.x) / (2.0 * PI) + 0.5;   // see toUnitVector()
    float v = acos(clamp(ng.y, -1.0, 1.0)) / PI;

    // The u seam makes dFdx explode on one pixel column; pick whichever of the
    // two phase offsets has the smaller derivative and sample with textureGrad.
    vec2 uvA = vec2(u, v);
    vec2 uvB = vec2(fract(u + 0.5), v);
    vec2 dxA = dFdx(uvA), dyA = dFdy(uvA);
    vec2 dxB = dFdx(uvB), dyB = dFdy(uvB);
    vec2 dx = dxA, dy = dyA;
    if (dot(dxB, dxB) + dot(dyB, dyB) < dot(dxA, dxA) + dot(dyA, dyA)) { dx = dxB; dy = dyB; }
    vec3 base = textureGrad(uTex, uvA, dx, dy).rgb;

    // Land is near-black in our texture, ocean is bright: luminance is the mask.
    float lum   = dot(base, vec3(0.299, 0.587, 0.114));
    float ocean = smoothstep(0.06, 0.20, lum);

    vec3  L    = normalize(vec3(-0.42, 0.40, 0.82));
    float lam  = dot(n, L);
    float diff = clamp((lam + 0.28) / 1.28, 0.0, 1.0);   // wrapped, soft terminator

    col += base * (0.17 + 0.88 * diff);

    vec3  H    = normalize(L - rd);
    float spec = pow(max(dot(n, H), 0.0), 46.0) * ocean * smoothstep(0.0, 0.3, lam);
    col += vec3(0.62, 0.82, 1.0) * spec * 0.45;

    // Rim light: strongest where the surface turns away from the camera.
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col += vec3(0.20, 0.55, 1.0) * fres * (0.30 + 0.70 * diff);

    // --- markers, painted onto the surface so they occlude correctly -------
    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      if (i >= uMarkerCount) break;
      float d = distance(ng, uMarkerPos[i]);
      vec3  mc = uMarkerCol[i];

      // A dark separation ring first, otherwise the marker is lost in the
      // coastline glow, which lives in the same colour family.
      col *= 1.0 - smoothstep(0.055, 0.038, d) * 0.5;
      col += mc * smoothstep(0.036, 0.016, d) * 1.25;        // dot
      col += vec3(1.0) * smoothstep(0.015, 0.005, d) * 0.85; // hot core
      col += mc * smoothstep(0.12, 0.0, d) * 0.26;           // bloom

      if (i == uActive) {
        float ph = fract(uTime * 0.45);
        float r  = ph * 0.17;
        col += mc * smoothstep(0.013, 0.0, abs(d - r)) * (1.0 - ph) * 0.9;
      }
    }

    alpha = 1.0;
  }

  outColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[Globe3D] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

interface Globe3DProps {
  markers?: GlobeMarker[];
  className?: string;
  /** seconds per full revolution */
  period?: number;
}

export default function Globe3D({ markers = [], className = '', period = 48 }: Globe3DProps) {
  // Serialised: the hero passes a fresh array literal on every render, so
  // depending on `markers` itself would tear down and rebuild the WebGL context
  // each time. This re-initialises only when the marker set actually differs,
  // which also means no eslint-disable on the dependency array.
  const markerKey = JSON.stringify(markers);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
    });
    if (!gl) {
      setFailed(true);
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      setFailed(true);
      return;
    }
    const prog = gl.createProgram();
    if (!prog) {
      setFailed(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[Globe3D] link failed:', gl.getProgramInfoLog(prog));
      setFailed(true);
      return;
    }
    gl.useProgram(prog);

    // One full-screen triangle.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {
      tex: gl.getUniformLocation(prog, 'uTex'),
      res: gl.getUniformLocation(prog, 'uRes'),
      time: gl.getUniformLocation(prog, 'uTime'),
      yaw: gl.getUniformLocation(prog, 'uYaw'),
      tilt: gl.getUniformLocation(prog, 'uTilt'),
      count: gl.getUniformLocation(prog, 'uMarkerCount'),
      active: gl.getUniformLocation(prog, 'uActive'),
      mpos: gl.getUniformLocation(prog, 'uMarkerPos'),
      mcol: gl.getUniformLocation(prog, 'uMarkerCol'),
    };

    const used: GlobeMarker[] = (JSON.parse(markerKey) as GlobeMarker[]).slice(0, MAX_MARKERS);
    const mpos = new Float32Array(MAX_MARKERS * 3);
    const mcol = new Float32Array(MAX_MARKERS * 3);
    used.forEach((m, i) => {
      const [x, y, z] = toUnitVector(m.lat, m.lon);
      mpos.set([x, y, z], i * 3);
      mcol.set(m.color ?? [0.46, 0.86, 1.0], i * 3);
    });
    gl.uniform1i(U.count, used.length);
    gl.uniform3fv(U.mpos, mpos);
    gl.uniform3fv(U.mcol, mcol);

    // --- texture ------------------------------------------------------------
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 1x1 placeholder until the real image decodes, so the first frame is valid.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([10, 30, 70, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(U.tex, 0);

    let disposed = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = TEXTURE_URL;
    img.decode()
      .then(() => {
        if (disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        const ext = gl.getExtension('EXT_texture_filter_anisotropic');
        if (ext) {
          gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        }
      })
      .catch(() => { if (!disposed) setFailed(true); });

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    // --- sizing -------------------------------------------------------------
    let w = 0, h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nw = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const nh = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.res, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // --- interaction --------------------------------------------------------
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Centre longitude in radians is (-yaw - PI/2), so -0.785 puts 45W — the
    // Atlantic, with the Americas and Europe both in frame — facing the camera.
    let yaw = -0.785;
    // Axial lean. Positive tips the north pole towards the camera, which is
    // what dragging downwards should do.
    let tilt = (18 * Math.PI) / 180;
    const TILT_LIMIT = 1.1;   // ~63 degrees; past this the globe reads upside down
    let velocity = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pointerId: number | null = null;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velocity = 0;
      pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.006;
      velocity = dx * 0.006;
      tilt = Math.min(TILT_LIMIT, Math.max(-TILT_LIMIT, tilt + dy * 0.006));
    };
    const onUp = () => {
      dragging = false;
      if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
      pointerId = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    // --- loop ---------------------------------------------------------------
    let raf = 0;
    let visible = true;
    let prev = performance.now();
    const t0 = prev;
    const baseSpeed = reduced ? 0 : (2 * Math.PI) / Math.max(period, 1);

    const frame = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;

      if (!dragging) {
        yaw += baseSpeed * dt + velocity;
        velocity *= 0.92;
        if (Math.abs(velocity) < 1e-4) velocity = 0;
      }

      const elapsed = (now - t0) / 1000;
      gl.uniform1f(U.time, elapsed);
      gl.uniform1f(U.yaw, yaw);
      gl.uniform1f(U.tilt, tilt);
      gl.uniform1i(U.active, used.length ? Math.floor(elapsed / 2.6) % used.length : -1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (visible) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const io = new IntersectionObserver(([entry]) => {
      const nowVisible = entry.isIntersecting;
      if (nowVisible && !visible) {
        visible = true;
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!nowVisible && visible) {
        visible = false;
        cancelAnimationFrame(raf);
      }
    }, { threshold: 0 });
    io.observe(wrap);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [markerKey, period]);

  return (
    <div ref={wrapRef} className={`relative ${className}`} aria-hidden="true">
      {failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={TEXTURE_URL}
          alt=""
          className="absolute inset-0 h-full w-full rounded-full object-cover opacity-80"
        />
      ) : (
        <canvas ref={canvasRef} className="h-full w-full touch-none cursor-grab active:cursor-grabbing" />
      )}
    </div>
  );
}
