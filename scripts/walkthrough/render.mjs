// Assemble captured browser frames into a small, repository-friendly MP4.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const input = resolve("generated-artifacts/walkthrough");
const destination = resolve("docs/walkthrough");
mkdirSync(destination, { recursive: true });
const main = JSON.parse(readFileSync(`${input}/recording.json`, "utf8"));
if (main.chapters[0]?.title === "Welcome to Packyo") main.chapters[0].title = "Your trips at a glance";
const publicRecording = existsSync(`${input}/public/recording.json`) ? JSON.parse(readFileSync(`${input}/public/recording.json`, "utf8")) : { frames: [], chapters: [] };
const chapters = [...publicRecording.chapters, ...main.chapters], issues = main.issues;
const captured = [...publicRecording.frames, ...main.frames.map(frame => ({ ...frame, chapter: frame.chapter + publicRecording.chapters.length }))];
const order = [
  "Welcome to Packyo", "Sign in to your account", "Your trips at a glance", "Create a trip", "Join your pack", "The trip hub",
  "Everyone shares preferences", "Vote on destinations", "Discover real trip ideas", "Save a stay", "Save an activity",
  "Your travel profile", "Explicitly saved activities", "Your saved stays", "Build the pack wishlist",
  "Reuse a saved activity", "Add the saved wish", "Vote on wishes", "Review wishlist results",
  "Find somewhere to stay", "Accommodation preferences", "Reuse a saved stay", "Add a stay for the pack",
  "Tied stays stay tied", "Ask Packyo to break the tie", "One chosen stay",
  "Live AI itinerary generation", "The generated result", "Your trip overview", "Wishes and upcoming activities",
  "The day-by-day itinerary", "Activity details", "Edit your itinerary", "Redo activity choices", "Add another activity",
  "Price transparency", "Live price research", "Check sources before booking", "Practical trip information",
  "Map and directions", "The packing checklist", "Shared expenses", "Add and split an expense", "Settle up",
  "Talk with your pack", "Share and export", "Review the trip", "Keep the memories", "Trip alerts",
  "Account and preferences", "Plan together with Packyo",
];
const frames = order.flatMap(title => chapters.flatMap((chapter, index) => chapter.title === title ? captured.filter(frame => frame.chapter === index) : []));
// Keep the normal ending when the optional extras were not recorded.
if (!chapters.some(chapter => chapter.title === "Plan together with Packyo")) {
  const ending = chapters.findIndex(chapter => chapter.title === "Plan the next trip");
  frames.push(...captured.filter(frame => frame.chapter === ending));
}
if (!frames.length) throw new Error("No app frames recorded.");
const assEscape = text => text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
const time = (seconds, srt = false) => {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, whole = Math.floor(seconds) % 60;
  const fraction = Math.round((seconds % 1) * (srt ? 1000 : 100));
  return `${String(hours).padStart(srt ? 2 : 1, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}${srt ? "," : "."}${String(Math.min(fraction, srt ? 999 : 99)).padStart(srt ? 3 : 2, "0")}`;
};
const wrap = (text, max) => {
  const lines = [""];
  for (const word of text.split(/\s+/)) {
    const last = lines.length - 1;
    if (lines[last].length + word.length + 1 > max) lines.push(word);
    else lines[last] += (lines[last] ? " " : "") + word;
  }
  return lines;
};
let elapsed = 0;
const timeline = [];
const concat = [];
for (const frame of frames) {
  const chapter = timeline.at(-1);
  if (!chapter || chapter.index !== frame.chapter) timeline.push({ index: frame.chapter, start: elapsed, end: elapsed });
  const duration = Math.min(Math.max(frame.duration, 0.25), 2);
  concat.push(`file '${frame.file.replaceAll("'", "'\\''")}'\nduration ${duration.toFixed(4)}`);
  elapsed += duration;
  timeline.at(-1).end = elapsed;
}
concat.push(`file '${frames.at(-1).file}'`);
writeFileSync(`${input}/frames.ffconcat`, concat.join("\n") + "\n");
const styles = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1440
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,DejaVu Sans,25,&H002B2521,&H000000FF,&H00FCFBF8,&H00FCFBF8,-1,0,0,0,100,100,0,0,1,0,0,8,35,35,26,1
Style: Caption,DejaVu Sans,23,&H002B2521,&H000000FF,&H00FCFBF8,&H00FCFBF8,0,0,0,0,100,100,0,0,1,0,0,2,40,40,48,1
Style: Footer,DejaVu Sans,14,&H00847C77,&H000000FF,&H00FCFBF8,&H00FCFBF8,0,0,0,0,100,100,1,0,1,0,0,2,20,20,16,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
const events = [`Dialogue: 0,${time(0)},${time(elapsed)},Footer,,0,0,0,,PACKYO  ·  ACTUAL APP SCREENS  ·  DEMO DATA`];
let subtitles = "", markdown = "# Packyo app walkthrough\n\n";
markdown += "Recorded from the actual Expo web-rendered mobile app using an isolated demo account. No app screens were recreated. Example accommodation amounts and expense entries are demo data, not live booking quotes.\n\n";
markdown += "The captioned video is silent. The companion SRT contains the same chapter explanations.\n\n";
markdown += "## Files\n\n- [Watch the walkthrough](packyo-app-walkthrough.mp4)\n- [Download captions](packyo-app-walkthrough.srt)\n\n## Chapters\n\n";
timeline.forEach((segment, i) => {
  const chapter = chapters[segment.index];
  events.push(`Dialogue: 1,${time(segment.start)},${time(segment.end)},Title,,0,0,0,,${assEscape(chapter.title)}`);
  events.push(`Dialogue: 1,${time(segment.start)},${time(segment.end)},Caption,,0,0,0,,${wrap(chapter.caption, 46).map(assEscape).join("\\N")}`);
  subtitles += `${i + 1}\n${time(segment.start, true)} --> ${time(segment.end, true)}\n${chapter.title}\n${chapter.caption}\n\n`;
  markdown += `- **${time(segment.start).split(".")[0]} — ${chapter.title}:** ${chapter.caption}\n`;
});
writeFileSync(`${input}/captions.ass`, styles + events.join("\n") + "\n");
writeFileSync(`${destination}/packyo-app-walkthrough.srt`, subtitles);
markdown += "\n## Scope and limitations\n\n";
markdown += "- This is a feature walkthrough, not an exhaustive test of every possible state.\n";
markdown += "- Planning, votes, saves, packing and financial examples use temporary fixture records. The account and records are removed after recording.\n";
markdown += "- Native Apple/Google sign-in, notification delivery, external bookings, payments and iOS share sheets are not completed in this browser recording.\n";
markdown += "- Export, settlement and other forms may be opened to demonstrate their options without completing an external or destructive action.\n";
markdown += "- Most itinerary screens use a pre-existing demo plan. A separately labelled live-generation chapter, when present, records a real request and its result; waiting time is cut out.\n";
if (issues.length) markdown += "\n### Recording notes\n\n" + issues.map(issue => `- ${issue.title}: ${issue.issue}`).join("\n") + "\n";
markdown += "\n## Re-recording\n\n";
markdown += "Requires the managed API and Expo workflows, Chromium and FFmpeg. Run from the workspace root:\n\n";
markdown += "1. Start headless Chromium on debugging port 9223 with a fresh temporary user-data directory.\n";
markdown += "2. Run `pnpm --filter @workspace/api-server exec tsx scripts/walkthrough-fixtures.ts` to create an isolated demo pack and sign in the recording browser.\n";
markdown += "3. Run `node scripts/walkthrough/record.mjs`.\n";
markdown += "   Optionally create an empty reuse trip with the fixture script's `--prepare-extras` flag and record `node scripts/walkthrough/record.mjs --extras` for saved-item reuse, the AI tiebreak and a live generation. A separate signed-out Chromium on port 9224 supports `node scripts/walkthrough/record-public.mjs`.\n";
markdown += "4. Run `node scripts/walkthrough/render.mjs`.\n";
markdown += "5. Always run `pnpm --filter @workspace/api-server exec tsx scripts/walkthrough-fixtures.ts --cleanup`, then stop the recording browser.\n\n";
markdown += "Intermediate frames and fixture IDs remain in the ignored `generated-artifacts/walkthrough/` folder. Authentication tokens are never saved by the scripts. Only the finished compressed video, captions and recording tools belong in the repository.\n";
writeFileSync(`${destination}/README.md`, markdown);
console.log(`Encoding ${elapsed.toFixed(1)} seconds from ${frames.length} actual browser frames.`);
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "warning", "-y", "-f", "concat", "-safe", "0", "-i", `${input}/frames.ffconcat`,
  "-vf", `scale=600:1200,pad=720:1440:60:80:color=0xFCFBF8,subtitles=${input}/captions.ass,fps=12,format=yuv420p`,
  "-c:v", "libx264", "-preset", "fast", "-crf", "29", "-movflags", "+faststart", "-an",
  `${destination}/packyo-app-walkthrough.mp4`,
], { stdio: "inherit" });
console.log(`Video saved to docs/walkthrough/packyo-app-walkthrough.mp4`);
