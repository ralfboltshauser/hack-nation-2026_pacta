#!/usr/bin/env bash
set -euo pipefail

web_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_root="$(cd "$web_root/.." && pwd)"
source_root="$project_root/audio-source/raw"
output_root="$web_root/public/audio"

mkdir -p "$output_root"

# Turn the 24-second ElevenLabs Music v2 composition into a 22-second loop.
# Sequence: original 2..22s, then a 2s crossfade from 22..24s into 0..2s.
# The rendered endpoint therefore meets the exact material at the rendered start.
ffmpeg -hide_banner -loglevel warning -y \
  -i "$source_root/ambient-music.raw.mp3" \
  -filter_complex \
  "[0:a]asplit=3[head_input][middle_input][tail_input];\
   [head_input]atrim=start=0:end=2,asetpts=PTS-STARTPTS[head];\
   [middle_input]atrim=start=2:end=22,asetpts=PTS-STARTPTS[middle];\
   [tail_input]atrim=start=22:end=24,asetpts=PTS-STARTPTS[tail];\
   [tail][head]acrossfade=d=2:c1=tri:c2=tri[seam];\
   [middle][seam]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-2:LRA=7,afade=t=in:st=0:d=0.03,afade=t=out:st=21.97:d=0.03[out]" \
  -map "[out]" -ar 44100 -ac 2 -codec:a libmp3lame -b:a 128k \
  "$output_root/ambient-loop.mp3"

process_cue() {
  local input_file="$1"
  local output_file="$2"
  local duration="$3"
  local trim_start="${4:-0}"

  ffmpeg -hide_banner -loglevel warning -y \
    -i "$input_file" \
    -af "atrim=start=$trim_start,asetpts=PTS-STARTPTS,loudnorm=I=-17:TP=-2.2:LRA=7,alimiter=limit=0.86,volume=-1dB,afade=t=in:st=0:d=0.008,apad=pad_dur=2,atrim=end=$duration" \
    -ar 44100 -ac 2 -codec:a libmp3lame -b:a 128k \
    "$output_file"
}

# Candidate selection was made from measured temporal coverage, peak level,
# leading/trailing silence, waveforms, and spectrograms. Raw generations remain
# outside public/ so a future listening pass can swap them without another API call.
process_cue "$source_root/happy.raw.mp3" \
  "$output_root/happy.mp3" 1.18
process_cue "$source_root/wave.candidate-b.raw.mp3" \
  "$output_root/wave.mp3" 1.62
process_cue "$source_root/spin.candidate-b.raw.mp3" \
  "$output_root/spin.mp3" 1.48 0.04
process_cue "$source_root/curious.candidate-b.raw.mp3" \
  "$output_root/curious.mp3" 1.55

echo "Processed Pacta audio into $output_root"
