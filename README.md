# dsh-vidi

English | [中文](README.zh-CN.md)

A video tool for DeepSeek Harness: watch live streams, videos and podcasts with subtitles in any language, and let DeepSeek take frames, cut clips, download and summarise for you.

## What it does

- **Opens anything**: YouTube, Bilibili and other sites yt-dlp supports, Xiaoyuzhou podcast episodes, m3u8 / rtmp / srt streams, local files (drop them in), or a stream pushed from OBS.
- **Subtitles start by themselves** when a video opens; pause and resume any time. One or two languages (a main line and a second line); the site's own subtitles can be shown too, or used as a reference.
- **Two paces**: real-time shows lines as they are heard; polished arrives a little later with misheard words fixed from context.
- **The subtitle model looks at the video**: polishing uses the page's title, description and comments, and — when the chosen model reads images — a frame of that stretch. It also keeps a glossary of names and terms for the video.
- **Chat with DeepSeek beside the video**: grab this moment, cut this part, summarise, download the original — all in one conversation, with files saved in the video's folder.
- **Restream**: push the video with its subtitles drawn into the picture to Bilibili, Douyin, Kuaishou, WeChat Channels, Douyu, Huya, YouTube, Twitch or any RTMP/SRT address — several at once; each platform connects and reconnects on its own.
- **Export**: SRT / VTT subtitles, transcripts by line or paragraph, clips with subtitle tracks.
- English and Chinese interface; works on phones.

## Install

In DSH, open **Plugins → Install third-party plugin** and enter `dsh-vidi`. A **Video** button appears in the sidebar; pasting a video link in a chat also offers to open it.

Needs DSH 0.2.2 or later.

### Dependencies

| Tool | For | Install (macOS) |
|---|---|---|
| ffmpeg | playing, recording, frames, clips | `brew install ffmpeg` |
| yt-dlp | site videos | `brew install yt-dlp` |
| whisper.cpp (optional) | transcription on this computer | `brew install whisper-cpp`, then put `ggml-large-v3-turbo-q5_0.bin` in `~/.dsh/live/models/` |

Without whisper.cpp, pick an online service as the transcription model in settings.

## Two models

Set separately under the gear:

- **Transcription**: speech to text. Whisper on this computer by default; or OpenAI, Google Gemini, Groq, SiliconFlow, Zhipu GLM.
- **Subtitle model**: polishing, translation, glossary. DeepSeek by default; the list shows every model configured in DSH and marks the ones that read images.

Online transcription uses the model providers you have set up in DSH (Models page) — OpenAI, Google, Groq, SiliconFlow, Zhipu GLM: their key and address work as they are, whatever the key is called. A service DSH doesn't have yet can get a key right on the video page; it is checked, then saved in DSH.

## Restreaming

In the player, open **Restream**, add a platform (paste the server address and stream key from the platform's own streaming tool — e.g. Bilibili 直播姬, Douyin 直播伴侣, WeChat Channels Assistant), tick the ones to use and start. It starts from where you are watching, with the subtitles you see; for a live stream that is a few seconds behind live, so the lines are ready. Stream keys stay on this computer.

## Streaming from OBS

Open the video page: the empty page shows the server address and stream key. In OBS choose the "Custom" service and paste them. Default ports: RTMP 1935, SRT 9000 (changeable in the plugin settings).

## Where things are saved

Recordings, subtitles, frames and clips live in `~/.dsh/live/jobs/<id>/` (changeable in the plugin settings).

## Known limits

- Xiaoyuzhou video episodes only offer a one-minute preview on the web (the full video needs the app and a login), so they play as the full audio with the cover.
- Site videos that need a login use a browser's saved login (Settings → Site login).

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): use, change and share it freely for anything except commercial purposes. No copyleft: your own changes can stay under whatever terms you like, as long as the use is noncommercial.
