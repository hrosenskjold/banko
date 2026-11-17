# Banko-hjælperen 🎱

Hold styr på dine bankoplader, mens tallene bliver råbt op.

- 📷 Scan en plade med telefonens kamera (tal-genkendelse sker i browseren)
- ✍️ Eller indtast pladen i hånden
- ✔️ Kryds tal af – alle plader bliver udfyldt automatisk
- 🏆 Holder øje med 1 række, 2 rækker og fuld plade – med fanfare og konfetti
- ⟲ Nulstil runden, tilføj og fjern plader

Pladerne gemmes kun i din egen browser.

Kør lokalt: `python -m http.server` og åbn http://localhost:8000

## Sådan virker scanningen

1. **Find pladen:** gitteret findes automatisk (lokal tærskel → største figur af tynde streger →
   firkant → hver side snappes til den yderste rigtige streg). Det godkendes kun, hvis næsten alle
   14 gitterlinjer findes, så rod og kasser ikke forveksles med en plade.
2. **Ret ud:** perspektivet rettes, gitterlinjerne fjernes, og de rigtige kolonne-/rækkelinjer bruges
   (håndtegnede gitre er ujævne). Skraverede tomme felter genkendes og ignoreres.
3. **Læs tallene:** et lille CNN (`js/digits.js`, vægte i `js/digit-model.js`) læser hvert ciffer.
   Kolonnen hjælper (26 hører i 20'erne). Pladen læses begge veje, så den må ligge på hovedet.
   Usikre felter markeres gule i rettebilledet.

Alt kører i browseren – intet sendes nogen steder hen.

### Gentræn ciffer-modellen

Kræver numpy, scipy, Pillow, PyTorch og MNIST-filerne i `<mnist-mappe>`:

    python tools/make_digit_data.py <mnist-mappe> data.npz
    python tools/train_cnn.py data.npz <mnist-mappe> js/digit-model.js

Træningsdata: MNIST med kraftig variation, europæiske 1- og 7-taller, ~50 skrifttyper og en
"ikke et ciffer"-klasse. `tools/digitnorm.py` skal matche `normalizeDigit()` i `js/digits.js`.
