# Banko-hjælperen 🎱

Hold styr på dine bankoplader, mens tallene bliver råbt op.

- 📷 Scan en plade med telefonens kamera (tal-genkendelse sker i browseren)
- ✍️ Eller indtast pladen i hånden
- ✔️ Kryds tal af – alle plader bliver udfyldt automatisk
- 🏆 Holder øje med 1 række, 2 rækker og fuld plade – med fanfare og konfetti
- ⟲ Nulstil runden, tilføj og fjern plader

Pladerne gemmes kun i din egen browser.

Kør lokalt: `python -m http.server` og åbn http://localhost:8000

## Tal-genkendelse

Tallene læses af et lille neuralt netværk (`js/digits.js`, vægte i `js/digit-model.js`),
trænet på MNIST (håndskrift) og cifre i ~45 skrifttyper. Alt kører i browseren – intet sendes nogen steder hen.

Gentræn modellen (kræver numpy, scikit-learn, Pillow og MNIST-filerne i `<mappe>/mnist/`):

    python tools/train_digits.py <mappe> js/digit-model.js

`tools/digitnorm.py` skal matche `normalizeDigit()` i `js/digits.js`.
