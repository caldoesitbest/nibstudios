#!/bin/sh
# Builds from src/:
#   nib.html               page body for publishing as a claude.ai artifact (the host adds doctype/head)
#   dist/index.html        standalone page to upload to your own website
cd "$(dirname "$0")"
body() {
  cat src/head.html
  cat src/body.html
  echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.17/paper-core.min.js"></script>'
  echo '<script>'
  cat src/js/00-util.js src/js/01-state.js src/js/02-geom.js src/js/03-render.js src/js/04-tools.js \
      src/js/05-commands.js src/js/06-ui.js src/js/07-io.js src/js/08-main.js src/js/09-import.js \
      src/js/10-pdfexport.js src/js/11-trace.js src/js/12-design.js src/js/13-home.js src/js/99-boot.js
  echo '</script>'
}
body > nib.html
mkdir -p dist
{
  cat build/dist-head.html
  body
  cat build/dist-foot.html
} > dist/index.html
cp dist/index.html "Nib Vector Studio.html"
wc -c nib.html dist/index.html
