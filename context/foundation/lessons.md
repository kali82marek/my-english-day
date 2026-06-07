# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Zawsze uruchamiaj localhost na porcie 3030

- **Context**: Każde uruchomienie dev servera
- **Problem**: Agent uruchamia serwer na domyślnym porcie, który koliduje z innymi usługami na maszynie.
- **Rule**: Zawsze uruchamiaj localhost na porcie 3030.
- **Applies to**: implement

## Format audio nagrania musi być wspierany przez Whisper

- **Context**: Nagrywanie audio na froncie (S-01, `expo-audio`) → transkrypcja przez OpenAI Whisper.
- **Problem**: „Zwykłe" nagranie z telefonu bywa kontenerem **3GP** (`ftyp3gp4`) z rozszerzeniem `.m4a`. Whisper zwraca `400 Invalid file format` — wspiera tylko: `flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm` (3gp NIE). Samo rozszerzenie/MIME nie wystarcza — OpenAI sprawdza realny codec/kontener.
- **Rule**: W konfiguracji nagrywania (`expo-audio` preset) wymuś format wspierany przez Whispera — AAC/`.m4a` (kontener MPEG-4, nie 3GP) lub `wav`. Nie polegaj na systemowej nagrywarce ani domyślach platformy. Weryfikując transkrypcję lokalnie, używaj pliku w pewnym formacie (np. mp3 z OpenAI TTS), bo przypadkowe nagranie z telefonu może być 3gp.
- **Applies to**: implement, impl-review
