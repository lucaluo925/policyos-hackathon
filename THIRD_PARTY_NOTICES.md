# Third-party material and source boundary

The MIT license applies to original PolicyOS code and documentation. It does
not relicense externally retrieved pages, API responses, government marks,
news articles or other publishers' assets.

## Hosted models and retrieval services

PolicyOS calls NVIDIA models through the Nebius Token Factory API. This
repository distributes application code, not model weights or checkpoints.
The model identifiers in `src/lib/verify/nemotron.ts` and the provider's
catalog were checked on 13 October 2026:

| Runtime model | Application role | License listed by Nebius |
| --- | --- | --- |
| [`nvidia/nemotron-3-super-120b-a12b`](https://tokenfactory.nebius.com/models/catalog/text2text/nvidia%2Fnemotron-3-super-120b-a12b) | Claim decomposition and evidence screening | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/) |
| [`nvidia/Nemotron-3-Ultra-550b-a55b`](https://tokenfactory.nebius.com/models/catalog/text2text/nvidia%2FNemotron-3-Ultra-550b-a55b) | Evidence adjudication and bounded decomposition fallback | [OpenMDW-1.1](https://openmdw.ai/license/1-1/) |

These are dated provider-catalog observations, not a grant of rights from
PolicyOS. Model materials and hosted service access retain their own terms;
the MIT license for this repository does not replace those terms. The
[Nebius service agreement](https://docs.nebius.com/legal/agreement) governs
the hosted service. Tavily Search and Extract are external API services;
retrieved publishers' text remains subject to its original source terms.
Provider and model names identify runtime dependencies and do not imply
endorsement of PolicyOS or its verdicts.

## Included source data

The 217-entry country/economy directory in
`src/lib/data/country-directory.json` comes directly from the World Bank
country API. It records its provider URL, retrieval time and missing
coordinates. PolicyOS excludes regional aggregates and retains missing
coordinates rather than inventing them. The map links to the source. The
[World Bank dataset terms](https://www.worldbank.org/ext/en/legal/terms-conditions/datasets)
default to CC BY 4.0 unless data are marked otherwise; the source, license
and these transformations are attributed here. Directory presence does not
imply a live policy feed or score.
Dataset attribution: **The World Bank: Countries: World Bank Country API**.
The linked World Bank dataset terms require attribution and prohibit implying
endorsement; PolicyOS has no affiliation with the World Bank.
The globe texture is generated from Natural Earth data through `world-atlas`;
[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) describes
its map data as public domain and
[`world-atlas`](https://github.com/topojson/world-atlas) carries an ISC license
for distribution tooling. Installed npm packages retain their own licenses.
The `/explore` map also serves a local, property-stripped Natural Earth 1:50m
geometry asset; the previous 1:110m asset is retained. [Their pinned sources and reproducible transformation](MAP_DATA_SOURCE.md)
are documented in this repository. The map does not request third-party
basemap tiles or demonstration glyphs at runtime; its numeric markers use
local fonts. These polygons are geographic context, not a source
of policy or jurisdiction claims.

Official-announcement readers fetch titles, dates and links directly from
registered public feeds at runtime. They link each result to its issuing
source and distinguish collection time from source publication time. Source
publication does not prove that a policy is legally effective. Examples of
registered sources include [Malaysia MITI](https://www.miti.gov.my/index.php/pages/view/10936),
[New Zealand Beehive](https://www.beehive.govt.nz/feeds),
[France's Ecology Ministry](https://www.ecologie.gouv.fr/flux-rss), and
[Italy's Civil Protection Department](https://www.protezionecivile.gov.it/en/rss/).
Three compact Atom/RSS fixtures are constructed from feed fields for parser
tests; four HTML parser fixtures are self-authored synthetic test input.

## Excluded research records

The public candidate excludes the old saved retrieval excerpts, extracted
page text, model adjudication inputs and frozen evaluation packets. Claim
starters under `public/verify-prompts/` include only authored claims and IDs;
they are not saved verdicts. `npm run verify:seed` writes new raw records to
ignored `private/` storage. Do not commit that directory or copy those
records into a public demo without reviewing every source's rights.

The [BOE reuse notice](https://www.boe.es/informacion/aviso_legal/) authorizes
reuse of covered documents subject to attribution and other conditions, but
does not grant rights to third-party text linked beside a BOE document.
One dated example under `public/verify-recordings/` uses selected passages
from [BOE-A-2025-9963](https://www.boe.es/buscar/doc.php?id=BOE-A-2025-9963)
and its [correction](https://www.boe.es/boe/dias/2025/06/14/pdfs/BOE-A-2025-11957.pdf).
Its six published passages are the exact BOE inputs supplied to adjudication
in a real local run. Other publishers' retrieval and screening text from that
run is withheld. PolicyOS selected the passages and verdict; its analysis is
not official or endorsed by BOE. Because the example extracts and combines
passages, it uses BOE's derived-data attribution wording, “Basado en datos de
la Agencia Estatal Boletín Oficial del Estado,” with the source and reuse links.
The source document was published 21 May
2025 and the correction 14 June 2025.
No World Monitor code, assets or branding is used by PolicyOS.

The dated EU AI Act example reproduces one unchanged 900-character passage
from the recorded adjudication input. Source: **AI Act regulatory framework**,
European Union / European Commission, Digital Strategy:
https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai
The source's [legal notice](https://digital-strategy.ec.europa.eu/en/pages/legal-notice)
licenses EU-owned website content under CC BY 4.0 unless otherwise indicated.
PolicyOS selected this passage; it does not reproduce the complete source
page or the complete model input. Six other adjudication passages and all
earlier retrieval/screening text are withheld, with omitted URLs listed in the
record. Recorded model output, timestamps and call counts are preserved.
The selected passage and its reuse terms are separate from the MIT code
license. This is nonofficial analysis; no European Union endorsement is implied.
