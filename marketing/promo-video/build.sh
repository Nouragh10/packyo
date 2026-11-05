#!/usr/bin/env bash
# Builds packyo-promo-9x16.mp4 (1080x1920, ~25s) from the two app recordings in the repo root.
# Usage: node graphics.mjs && ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
A="$ROOT/Packyo-Sep-2-20-10-34.mp4"     # recording 1
B="$ROOT/GoPackNow-Sep-7-08-32-04.mp4"  # recording 2 (also the music source)
G=build
OUT=packyo-promo-9x16.mp4
FPS=30
PW=766; PH=1360; PX=157; PY=500          # phone screen box, matches graphics.mjs

# --- Edit decision list: source, start (s), length (s) ---------------------
CUTS=(
  "B 15.7 2.5"   # Lisbon tram hero          (hook)
  "B 8.0  3.0"   # create trip form          (step 1)
  "B 27.5 3.0"   # pack wishlists            (step 2)
  "B 36.0 2.0"   # swipe-to-vote card        (step 3)
  "B 40.5 2.0"   # vote results
  "B 45.0 2.0"   # building your trip        (step 4)
  "A 67.5 2.5"   # day-by-day itinerary
  "B 60.5 1.5"   # packing list              (extras)
  "A 75.0 1.5"   # group chat
  "B 73.0 2.0"   # trip memories
)
# Captions: png, start, end (seconds on the output timeline)
CAPS=(
  "c0 0.0 2.5"
  "c1 2.5 5.5"
  "c2 5.5 8.5"
  "c3 8.5 12.5"
  "c4 12.5 17.0"
  "c5 17.0 22.0"
)
END_LEN=3.9; XFADE=0.4

# --- 1. Footage track: trim + concat, scaled to the phone screen ------------
fc=""; n=0; t=0
for c in "${CUTS[@]}"; do
  read -r src ss len <<<"$c"
  idx=$([ "$src" = A ] && echo 0 || echo 1)
  fc+="[$idx:v]trim=start=$ss:duration=$len,setpts=PTS-STARTPTS,fps=$FPS,scale=${PW}:${PH}:flags=lanczos,setsar=1[v$n];"
  n=$((n+1)); t=$(echo "$t + $len" | bc)
done
for i in $(seq 0 $((n-1))); do fc+="[v$i]"; done
fc+="concat=n=$n:v=1:a=0[foot]"
MAIN_LEN=$t
ffmpeg -v error -y -i "$A" -i "$B" -filter_complex "$fc" -map "[foot]" -c:v libx264 -crf 14 -preset fast -pix_fmt yuv420p "$G/footage.mp4"

# --- 2. Composite: background + rounded phone + animated captions -----------
inputs=(-loop 1 -framerate $FPS -t "$MAIN_LEN" -i "$G/bg.png" -i "$G/footage.mp4" -loop 1 -framerate $FPS -t "$MAIN_LEN" -i "$G/mask.png")
fc="[1:v][2:v]alphamerge[phone];[0:v][phone]overlay=$PX:$PY:shortest=1[base0];"
k=3; prev=base0
for c in "${CAPS[@]}"; do
  read -r id s e <<<"$c"
  d=$(echo "$e - $s" | bc)
  inputs+=(-loop 1 -framerate $FPS -t "$d" -i "$G/$id.png")
  fo=$(echo "$d - 0.2" | bc)
  # The opening caption is fully visible on frame 1 (it doubles as the thumbnail); later ones animate in.
  if [ "$s" = "0.0" ]; then fin=""; y=0; else fin="fade=in:st=0:d=0.3:alpha=1,"; y="'40*pow(max(0,1-(t-$s)/0.35),2)'"; fi
  fc+="[$k:v]format=rgba,${fin}fade=out:st=$fo:d=0.2:alpha=1,setpts=PTS-STARTPTS+$s/TB[cap$k];"
  fc+="[$prev][cap$k]overlay=0:$y:eval=frame:enable='between(t,$s,$e)'[base$k];"
  prev=base$k; k=$((k+1))
done
# End card: slow push-in, crossfaded from the main section
inputs+=(-loop 1 -framerate $FPS -t "$END_LEN" -i "$G/end.png")
fc+="[$k:v]scale=1188:2112,zoompan=z='min(1+0.0009*on,1.1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=$FPS,setsar=1[end];"
fc+="[$prev]format=yuv420p,setsar=1[mainv];[end]format=yuv420p[endv];"
off=$(echo "$MAIN_LEN - $XFADE" | bc)
fc+="[mainv][endv]xfade=transition=fade:duration=$XFADE:offset=$off[vout]"
TOTAL=$(echo "$MAIN_LEN + $END_LEN - $XFADE" | bc)

# --- 3. Audio: the recordings' soundtrack, faded in/out ---------------------
ain=$((k+1))
inputs+=(-i "$B")
fo=$(echo "$TOTAL - 1.5" | bc)
fc+=";[$ain:a]atrim=0:$TOTAL,asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=$fo:d=1.5,loudnorm=I=-14:TP=-1.5[aout]"

ffmpeg -v error -y "${inputs[@]}" -filter_complex "$fc" -map "[vout]" -map "[aout]" \
  -c:v libx264 -crf 18 -preset slow -profile:v high -pix_fmt yuv420p -r $FPS \
  -c:a aac -b:a 192k -movflags +faststart -t "$TOTAL" "$OUT"
echo "Wrote $OUT (${TOTAL}s)"
