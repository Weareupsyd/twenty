// Card background pattern generators - all output data-URI SVGs for inline use.
// Inline data URIs are required because html-to-image cannot capture CSS
// pseudo-elements or external stylesheets during DOM-to-image conversion.

/**
 * Driver-license-style guilloche - concentric rosette curves with
 * varying amplitude and phase offsets that weave through each other.
 * Tile: 200x200, drawn with fine 0.4px strokes.
 */
export function guillocheDataUri(): string {
  const w = 200, h = 200;
  const cx = w / 2, cy = h / 2;
  let paths = '';

  // Rosette: overlapping parametric curves radiating from center
  const curves = 12;
  const steps = 360;
  for (let c = 0; c < curves; c++) {
    const phase = (c * Math.PI * 2) / curves;
    const rBase = 30 + c * 6;
    let d = '';
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * Math.PI * 2;
      const r = rBase + Math.sin(t * 6 + phase) * 12 + Math.sin(t * 3 - phase) * 8;
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      d += s === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`;
    }
    paths += `<path d="${d}" fill="none" stroke="rgba(34,211,238,0.4)" stroke-width="0.4"/>`;
  }

  // Horizontal wave bands that interleave with the rosette
  for (let band = 0; band < 10; band++) {
    const y0 = band * 20 + 10;
    let d = `M0,${y0}`;
    for (let x = 0; x <= w; x += 1) {
      const y = y0 + Math.sin(x * 0.08 + band * 0.7) * 5 + Math.sin(x * 0.15 - band) * 3;
      d += ` L${x},${y.toFixed(1)}`;
    }
    paths += `<path d="${d}" fill="none" stroke="rgba(34,211,238,0.25)" stroke-width="0.3"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${paths}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Fine security crosshatch - tight diagonal lines like the background
 * hatching on government IDs. Tile: 10x10, very fine strokes.
 */
export function crosshatchDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
    <path d="M0,0 L10,10 M10,0 L0,10 M0,5 L10,5 M5,0 L5,10" fill="none" stroke="rgba(34,211,238,0.2)" stroke-width="0.25"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Repeating "KABILA VERIFIED" microtext strip - tile 300x12. */
export function microtextDataUri(): string {
  const text = 'KABILA VERIFIED  \u00b7  '.repeat(4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="12">
    <text x="0" y="9" font-family="monospace" font-size="6" fill="rgba(34,211,238,0.6)" letter-spacing="1">${text}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Pre-encoded fingerprint icon - avoids network fetch during export. */
export const FINGERPRINT_ICON_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAtCAYAAAA6GuKaAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6ggaDQwhnNuifwAADM1JREFUWMPtmXl01UWWxz/1ey8LhC2EKIEACWZEgraMgDO2Y3caMQyyi3FjoHFQ2lGg23bhqGijbI56aBkRxIVWCd2NgGbckEUbiIqskgCBhJCdLJB9ectvqTt/vJeXYBOExvbMH33P+Z33q1tV937vUvW7VQ/+QT8Oqb9xjoRaqalRXH9TPL1796e2PgZDKTp3raGxupzdu8rZsqX2O7rkYhVeCrkASE4OZ9mqyWQX7MSWFkQEHXzkrx8lYqmKqiw2vn8/CQmRQVnG39vTbsBm9uN9+PWjfyQp9ud4gjM7AV6rRdU25UtRUYFRU1eulVujrCiVmHgFA/peIV0i45E2Ta7SU3udl5fdzrJlpUAYYP2QnjUAxbBxnVVe9QFMESotjRZRxyv2sWTVOFKnRV2QpDlPJJN9fC0igmkJIuIqLPnzDwmWoAdg4/5f4oiQZ1poEbYefJNh4zqfZdSFUWiccSj3mWDaCIMGdf1BAav95R9wyhHKba0Ka48HwapgfwDEfXPi2bTtdxwt2k2T5wyOtOCIF1sa1ZmGAg5k/YkXV/xLUK4r+CiSk7uQmhp1EUZfgFs2F+4gy2fTIELG4SeD7EhAkZQUQcZXi/DpRiwRmrTgb7f4rOCvI4Ldrv366yPOiuKCJVfy2GO3kpYWG+S7Lwm08epX/628IixMTz1L4JZDb6JFKLMFnwgeq56Pd69k3qKfMmZqN1JS3IBBUlIEs+b25+W3pqtTZ/IQEU7kbw45pbb5SPsdxsgrXN3a9bdidrV7D4BdtWUcXhHybI1XhEPlmdzzyIB2ijpSFuCPHRsd4nx5NB0RYXPmCsakxZJX+jUi4n7l9dGX5OmzAO8q20mxI+TbmrKWYh5aEtPOuNb9VjFpUgxTZlzFlOk/IW1633aGnLVgVWXDMSVihnSkpPRCRIz0TS/9MIDz/DXsarY4LcLafbODfWGhaMx/7VaVffoIluhQ/lrBfBYRVVGXzxvv3XlWBN/+aDYiwsmSwyx/azKNvjpEhF8+NIRLSA83gDrkq+fjOpMSEWbOHxwUGAHAS+t/RotuodTWlGjBFKGouYqsU19yrHInJyryEREaHE29pRHRvLD6upCGb/KeRkTwBvP6pdX/dikeNgDUhoJ9ZNT6yRchbXZikB8WTJdPKNdCtt+m3vaweO10kpIizintnU/H0CQWFT4TLcI3J37TXg/NvnK0CAteHHUpXobZr05ni0fY7QiPrxlN294MOQ35fNViUiHCR8eWB2cozl1LqNaUUEcKN9PgBFJn3ea0UP/zq+7AFFENnuLvzGv/e15SACqj1kd6maVW7v/yrHT5rGQPXzT7KRFh4fpRwb5wQJGS4mbm4zez8J3HWPbHB7l3TnKw39VqsNpXtJHTjoOIkJbWHXAzbFiY8osfEWHiXf0AxbhxvVROwUfcOKErF1RYjZ87kfcbhe0ijEjtF5r06Fv3s9snZGth6YaJ7QDDun0LaBGhRIRKEcpFqBOhTry8kH5jcGwEgDrtqaFMC7tztoY8tSPnU7wixpqMZwHUF/u3YImoo4W7Ligz1NMfbue1PFFv5OWf5f2/eP38b42l3j3aKiiQLpmlmRzwaQpE2JafwW9fnsATq6axv3Q/5SLUi7Bh/9yQrMeW3ERzsIydMCFQdzy8aDyWCKWNuQDMWzQeW8Ro8jVcGOiVuWd4o1CMB1YsDzH/febNbPMLu0VImZQQyrUn181jn0/IF+HOh65sZ2Sgf9knE6kMboGB/sAiP+VrpFGEp34/FYBJM3pgiiiftkhKimDsPdHoYEE1aVKP78McrlYW2vyhQpjw8F0h7rz0FaSXi1pfWnnW6G21dezwCAs3zDmHrADAjMPvk6tFbcv7S8gxGYc/oVjE+Ojb9BCv0teILcKUGf8EoGrNJkwRHln0MzoSDsCgGyMw3C6UGypOlocEhndLxnHgVNGJ0NiEoT2I7NGDbp1g/SsZ/PVK14CSXVvXEKYgJmZoa4fkZGVjgFbugaHRJU2leIABVw4GoKyhDB8Y3XsOPz9of4sL0wS/HyzxhvhhUV0wLagqrwnxvNrCtIUGG5JHJHYQOaFT9HU0OWCKL6Swvs6DH9TlsW01TmHZGbxgdOuZBEBlXSnNQFz/5HMJbgPdTVuYfrAdUE6nEN/nc/CbGNppO5BWZbeowsJiiksddfe8TQQOq60gAnmdkBLJHfc+S4Pfkf3ZmaG5w1OupE5DfmmbEzw+Lz7QfjMGQBUVVOMFlXTlZecDrcjO9uPx+Wiuh5jBOhRyLRamH+03w9rPk00v3EaXWJfUNkXzYX0j4x+8joSESJJTopi7PI13t3k5Xuzj8s4u3nxuVqsu3SfuZhwTdSRrX0har7jLaRYMWwfaTU2CVwD3Offp1sJbXKN+M8ExWyKxw+CWGZnEDbyPtQ+9JWLb+E2wzPaGakZMWcrpMouIyDAqKqOYtnAvXZcHTG2qFYpLTZITI3nmqWs4tKMBMLjnqevpFB1HpIE++NX6EIpOnftgOugWTxGARPfrgg3O3gP+jj09ePwQ5xezNlF27DDrn+6rcrM/Z9iYNxk2Oo6aOj+OA7bdarXm9qfSiP/JaIyIMHZufIYT375IzWmbguNQmGsR1VOphprtzBoezvolxwAXKSlKPfC73eSWOCq3qJjNf8gBFH2vipHo2MsxXNBQ/g0A4VEDaPLjjupS1qGnja5dRmrc8PnqyZQeKJfK3DSuyawlKuGfOXOinn6DwG7Lf9Vr4K+kqgTlVvny7mMLGTAsjoVb5lFdYqtuPS15eEqM5H7YTOAj5DD58cHc/+wROXHS5JqrImXu5JTgGnCYNu8+qupRnQ1T1q04DEBcfCIukIO7szvytNIFB99WTVUwZekxxj75HDNeLaWpHnat3o4REYNlgeOEVrt4PV7c4XB8TxaAkTr1fmoqIKa/W54bH0/uhyYgTPjtEF47Vsg9T+ZwMtdSiVdFsvSRoXyT0VYgjZ66lBavVrs+3wDAjeP6S6fu3XCH45QXfNkRaKE61yPvzIxVLZW5XPWLR5W36RRr7o4DTLQlWBZoJzzkacfW2DaICnyKWzwaW6Mq8gsoOVwH+I35n6Yzed5B6uv7YGqU4TohU4dH8cGyw8EIO2pNbjZFhZaKjTP0/zzxXwDGDZMeoOo0qrbBw2fpuedbiA4VebXyxvRrIHTZFqjuovvHiN8DoiJDsyxLsB1wbBeAdrDRNogE5A279RqdOHwqZbmW6trTJ28/mijb1pQTKJyE+Hg3z2WeFNMbR1xft/HeK/c41bnNAHrkHY9TX6fVoS82dnTp1/7Yrtu9K64eM8BI+dUebfuiieyBVJ1ouxESR2P7IbxrMM9tB8sGHVysnbol0VwP0XFhMjupc0hmUhJMWPQGQ2+ZyakcHwOvdhv7ds53Vs79E4CxIGONPn3aoHeC0ht+P4/vXnaeA3R7krBrJ2+3tI5RnXqgsj6do7evWBFMJ60sv0dsC9xh4cE4aWwLtBUA7fM0YxjgbWkGbADGPJjKHYu3UJJlc6ZMq8sHutzpC663Plq+DzCYsSRVD77pXppqxMjc+JbO2VfZAbYOQbutdbMSXVffPs45svEzAScI2AC09Ls2FctEqk6eDOS0BscCy28EIxEAaih3cI5b3fLrLZKT6eey/uGu3e9NczYuXme11uSzV09gxMQPKD7mU9G9mvTiu+6jdXe5CNA2gHNk48fBdkBAQko3Y+SMI9r0dadHIny7+bmgiQrTAjsI2tEmYS5wAsUew1K6ia8FevWPYMP8oc7ej48CBvHxLvUfK7ZJ7ytGUXrMp+KT3DJjWp/zAYYLvyd2jJEPL+W2+XXaNmPp0TecPevvpPRAwNO2KWgbbCvw6XdEBw5arkAdkl/gYPlABKrrvYBtTH5qtpqX6RFcP8frERXe6YzM6BcOO+R8gM/n6XOMdMUrxwGlqmXD/H/l5K6ykEe0CY4DogOglaExDHC7gu3GgFGOBWFWJICKG3a39tWhuvd1jD2b7ncyFr9D613490G5UMh660vTyPnzLMrKvLQdWE2unXQ9g0a+iN/rUF1wKJBMlgMCLkNBsoHRVSt3FGK4wd1dAYaz8rYbSPzpACn8uthpO9F/L+CLAR0QFgBMMHyOuv35r6XPkBtoqbZUz3i3rF87FjCwYqoQG5QSyDGpxZINC2529ewd5xzdmkVrBVn4deuXUbiI/2JcFzrwXGTEXjtExfa9ger8j+XN/0yGMwpw1IxFO2isqcBxIug/JJJvt+6kKq9Qig4epoO998ei7xociNoVky9Tr5UFQCUk91av5uuLlPu9dCkX2d9d4YEUOvnBabV31Hvy/Lei3GHIxiUTL170j0+BE073/tHBv+DOd3/9D/p/Tf8HQh9xA7oZE+gAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMjZUMTM6MDg6NTQrMDA6MDB/3D/vAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTI2VDEzOjA4OjU0KzAwOjAwDoGHUwAAAA50RVh0U29mdHdhcmUARmlnbWGesZZjAAAAAElFTkSuQmCC';
