# The cinematic world

Ei point's site is one film with the page on top of it. The whole 2 minute 30
second trailer runs full-bleed behind every route, the soundtrack loops with
it, and the page is the content layer. There are no raster image assets left
on the public site. Texture comes from gradients, an inline SVG turbulence and
the film itself.

## The rules

- **The film is the interface.** It is not a panel, not a widget, not a video
  you click "watch". It is the page. There is no play, pause or mute control
  anywhere in the interface, because there is nothing to control.
- **It loops.** The full 149.3 second trailer runs continuously on every route.
- **The soundtrack is part of the film.** The audio is trimmed to exactly
  149.3 seconds so the picture and the music stay in step on every loop.
- **The page is built on the film.** The home page is a sequence of scenes,
  one per beat of the trailer, and the copy in each scene is written from that
  beat. Scrolling the home page walks the same sequence the trailer plays.
- **The picture reframes with the reading.** The crop of the film walks down
  the source as the reader scrolls, and the frame grows very slightly, so the
  site reads as one continuous shot rather than a looping background.

## The film

| File | Format | Size | Used by |
| --- | --- | --- | --- |
| `public/media/film-1080.mp4` | H.264 high, 1920x1080, CRF 25, faststart | 90.3 MB | Every browser, full resolution |
| `public/media/film-540.mp4` | H.264 main, 960x540, CRF 30, faststart | 24.6 MB | Phones, under 820px |
| `public/media/loop.mp3` | 128 kbps, 149.3s | 2.9 MB | The soundtrack |
| `public/media/posters/*.jpg` | JPEG | 0.6 MB | The still frame before the film paints |

The source trailer is 1920x1080, 24 fps, 149.3 seconds, with a silent audio
track. The web encode keeps the native resolution and a low CRF, so the picture
is the source picture rather than a lookalike. The 540p copy is the same film
for phones, where the frame is cropped to portrait anyway.

`+faststart` puts the `moov` atom in front of the media data, so the browser
can start playing the first seconds immediately while the rest of the film
streams in behind it. The original trailer had `mdat` first and could not
seek or start at all.

VP9 was tried as a third format and rejected: at CRF 31 this content came out
at 98 MB, no smaller than the H.264 original and twice the bytes of the
540p cut, for a codec that is not universally supported in `<video>`.

## The scenes

The home page's scenes are the trailer's beats. The copy is written from the
frame the scene sits on.

| # | Beat | Eyebrow | Copy | What the scene carries |
| --- | --- | --- | --- | --- |
| 1 | The call | The call | A city that answers back | What the operation is |
| 2 | One account | One account | Every region, every plan | The catalogue |
| 3 | Momentum | Momentum | Progress that keeps its pace | The three steps of an order |
| 4 | Your terms | Your terms | Play it the way you like | Membership, referrals, cards |
| 5 | Quiet by design | Quiet by design | No noise, no waiting room | The five supported games |
| 6 | The term | The term | Day one to day thirty | The 30-day term |
| 7 | Handled | Handled | Settled while you play | Orders and servers |
| 8 | Ready | Ready | Ready when you are | The close and the FAQ |

## The media pipeline

The source trailer is not in the repository. It lives on the owner's machine.
Everything below was produced from it with ffmpeg 9.

```bash
# The film, native 1080p, H.264, short GOP, faststart, no audio track.
ffmpeg -i trailer.mp4 -an \
  -vf scale=1920:1080:flags=lanczos \
  -c:v libx264 -profile:v high -crf 25 -preset medium \
  -g 8 -keyint_min 8 -sc_threshold 0 \
  -movflags +faststart -pix_fmt yuv420p film-1080.mp4

# The same film, lighter, for phones.
ffmpeg -i trailer.mp4 -an \
  -vf scale=960:540:flags=lanczos \
  -c:v libx264 -profile:v main -crf 30 -preset medium \
  -g 6 -keyint_min 6 -sc_threshold 0 \
  -movflags +faststart -pix_fmt yuv420p film-540.mp4

# The soundtrack, trimmed to the length of the film so the two stay in step.
ffmpeg -i loop.mp3 -t 149.3 -c:a libmp3lame -b:a 160k loop.mp3
```

Short GOPs matter: a keyframe every eight frames is what makes seeking feel
instant instead of stuttering.

## Accessibility and performance

- The film is decorative, so it sits behind `aria-hidden` and the content
  carries the meaning.
- `prefers-reduced-motion` never plays the film. The poster frame stands in
  and every entrance is present rather than animated.
- A background tab stops decoding and stops the music with it.
- The film is one element, mounted once in the root layout, and it is never
  re-created by navigation.
- The soundtrack starts when the browser allows audible playback, which in
  practice means the first interaction with the page. Browsers refuse to play
  sound before that, and no amount of code changes that.
