# Third-party material and source boundary

The MIT license applies to original PolicyOS code and documentation. It does
not relicense externally retrieved pages, API responses, government marks,
news articles or other publishers' assets.

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
