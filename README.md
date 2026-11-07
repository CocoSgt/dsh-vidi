# dsh-vidi

English | [中文](README.zh-CN.md)

A video tool for DeepSeek Harness: watch live streams, videos and podcasts with subtitles in any language, and let DeepSeek take frames, cut clips, download and summarise for you.

## What it does

- **Opens anything**: YouTube, Bilibili and other sites yt-dlp supports, Xiaoyuzhou podcast episodes, m3u8 / rtmp / srt streams, local files (drop them in), or a stream pushed from OBS.
- **Subtitles start by themselves** when a video opens; pause and resume any time. One or two languages (a main line and a second line); the site's own subtitles can be shown too, or used as a reference.
- **Two paces**: real-time shows lines as they are heard; polished arrives a little later with misheard words fixed from context.
- **The subtitle model looks at the video**: polishing uses the page's title, description and comments, and — when the chosen model reads images — a frame of that stretch. It also keeps a glossary of names and terms for the video.
- **Chat with DeepSeek beside the video**: grab this moment, cut this part, summarise, download the original — all in one conversation, with files saved in the video's folder.
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

Online services use the keys DSH already has (the ones entered on its Models page work as they are); a key entered on the video page is checked, then saved in DSH.

| Transcription service | Key names read |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| Groq | `GROQ_API_KEY` |
| SiliconFlow | `SILICONFLOW_API_KEY` |
| Zhipu GLM | `GLM_API_KEY`, `ZHIPUAI_API_KEY` or `ZAI_API_KEY` |

## Streaming from OBS

Open the video page: the empty page shows the server address and stream key. In OBS choose the "Custom" service and paste them. Default ports: RTMP 1935, SRT 9000 (changeable in the plugin settings).

## Where things are saved

Recordings, subtitles, frames and clips live in `~/.dsh/live/jobs/<id>/` (changeable in the plugin settings).

## Known limits

- Xiaoyuzhou video episodes only offer a one-minute preview on the web (the full video needs the app and a login), so they play as the full audio with the cover.
- Site videos that need a login use a browser's saved login (Settings → Site login).

## License

MIT
