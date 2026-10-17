#!/bin/bash
# Plays a job agent. The payload's `label` picks the behaviour:
#   (anything else) draw valid scene at payload.target, layout, commit
#   uncommitted | nochange | fail | slow | outside | invalid | wrongpath
prompt="${@: -1}"
printf '%s\n---ARGS---\n%s\n' "$prompt" "$*" > "${DUMMY_LOG_DIR:-/tmp}/last-prompt-$$.txt"
echo "cwd=$(pwd) HOME=$HOME" >> "${DUMMY_LOG_DIR:-/tmp}/last-prompt-$$.txt"
export PROMPT="$prompt"
read -r jobid label target < <(node -e '
const p=process.env.PROMPT;
const job=(p.match(/job-[0-9a-f]{12}/)||[""])[0];
const m=p.match(/<<<PAYLOAD-[0-9a-f]+\n([\s\S]*?)\nPAYLOAD-[0-9a-f]+>>>/);
let pl={};try{pl=JSON.parse(m[1])}catch{}
console.log(job,(pl.label||"ok").replace(/\s/g,"_"),pl.target||"docs/architecture/new.scene.json")')
CLI="node $ARCH_ROOT/dist/cli.js"
draw() { # $1 file
  mkdir -p "$(dirname "$1")"
  cat > "$1" <<JSON
{ "formatVersion": 1, "id": "e2e.$(basename "$1" .scene.json)", "title": "Drawn by dummy",
  "nodes": [ {"id":"a","label":"A","preset":"core"}, {"id":"b","label":"B","preset":"box"}, {"id":"c","label":"C","preset":"cylinder"} ],
  "edges": [ {"from":"a","to":"b","kind":"dependency"}, {"from":"b","to":"c","kind":"dataflow"} ] }
JSON
  $CLI layout "$1" >/dev/null
}
case "$label" in
  nochange) echo "nothing to do"; exit 0;;
  fail) echo "boom" >&2; exit 3;;
  slow) sleep 300; exit 0;;
  invalid) mkdir -p "$(dirname "$target")"; echo "not json {" > "$target"; git add -A; git commit -q -m "scene.draw: $jobid"; exit 0;;
  wrongpath) draw docs/architecture/elsewhere.scene.json; git add -A; git commit -q -m "scene.draw: $jobid"; exit 0;;
  studioformat) mkdir -p "$(dirname "$target")"; echo '{ "hud": {"title":"Drawn in studio format"}, "nodes": [{"id":"token","label":"Token cache"},{"id":"keys","label":"Keys"}], "links": [{"from":"token","to":"keys"}] }' > "$target"; git add -A; git commit -q -m "scene.draw: $jobid"; exit 0;;
  uncommitted) draw "$target"; exit 0;;
  outside) draw "$target"; echo "x" > outside.txt; git add -A; git commit -q -m "scene.draw: $jobid"; exit 0;;
  *) draw "$target"; git add -A; git commit -q -m "scene.draw: $jobid"; exit 0;;
esac
