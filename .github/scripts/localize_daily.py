import os, json, re
from pathlib import Path
from openai import OpenAI

ROOT = Path(".")
LOCALES = [
    ("fr","French","France"),("de","German","Germany"),("es","Spanish","Spain"),
    ("pt","Portuguese","Brazil"),("it","Italian","Italy"),("hi","Hindi","India"),
    ("vi","Vietnamese","Vietnam"),("id","Indonesian","Indonesia"),("tr","Turkish","Turkey"),
    ("pl","Polish","Poland"),("nl","Dutch","Netherlands"),("ja","Japanese","Japan"),
    ("ko","Korean","South Korea")
]
PAGES = ["index.html","reddit-image-downloader.html","reddit-dp-downloader.html"]

def choose():
    requested = os.getenv("INPUT_LOCALE","").strip().lower()
    codes = [x[0] for x in LOCALES]
    if requested:
        for x in LOCALES:
            if x[0] == requested: return x
        raise SystemExit("Unsupported locale: " + requested)
    marker = ROOT/".github"/"last_locale"
    old = marker.read_text().strip() if marker.exists() else ""
    i = (codes.index(old)+1) % len(codes) if old in codes else 0
    return LOCALES[i]

def ask(client, prompt, web=False):
    args = {"model":"gpt-6-luna","input":prompt}
    if web: args["tools"] = [{"type":"web_search"}]
    return client.responses.create(**args).output_text

def main():
    locale, language, country = choose()
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    research = ask(client, f"""
Research current public web usage in {country} for {language}. Focus on natural
terms people use for Reddit video downloading, Reddit image downloading and
Reddit profile-picture/avatar downloading. Also research natural UI wording,
FAQ wording and local search intent. Do not invent search volume. Give sources
and explain regional vocabulary choices. Return a concise research brief.
""", True)

    source = {}
    for p in PAGES:
        source[p] = (ROOT/p).read_text(encoding="utf-8")

    prompt = f"""You are a senior human web localizer and technical SEO editor.
Target: {country} / {language} / {locale}.

Research brief:
{research}

Current English pages:
{json.dumps(source, ensure_ascii=False)}

Create these three localized files: {locale}/index.html,
{locale}/reddit-image-downloader.html and {locale}/reddit-dp-downloader.html.
Translate user-facing content naturally for the target country, not literally.
Preserve HTML structure, CSS classes, IDs, JavaScript hooks, scripts, images,
forms and real product behavior. Do not invent features or claims.
Set the html lang attribute correctly. Localize title, description, headings,
buttons, navigation, labels, FAQ, alt text and accessible labels.
Use natural local search wording without keyword stuffing.
Correct localized internal links so the three pages link to each other using:
/{locale}/, /{locale}/reddit-image-downloader.html,
/{locale}/reddit-dp-downloader.html.
Preserve the existing design. Do not copy generic homepage paragraphs into
subpages. Do not fabricate statistics, reviews or ranking claims.
Return ONLY JSON with keys index.html, reddit-image-downloader.html,
reddit-dp-downloader.html and complete HTML values. No markdown fences.
"""
    raw = ask(client, prompt)
    m = re.search(r"\{.*\}", raw, re.S)
    if not m: raise RuntimeError("Model did not return JSON")
    result = json.loads(m.group(0))
    target = ROOT/locale
    target.mkdir(exist_ok=True)
    for p in PAGES:
        html = result[p].strip()
        if "<html" not in html.lower(): raise RuntimeError("Invalid HTML: "+p)
        (target/p).write_text(html+"\n", encoding="utf-8")

    for p in PAGES:
        path = target/p
        html = path.read_text(encoding="utf-8")
        audit = ask(client, f"""Audit this localized ReditGrab page for concrete
SEO/technical/localization issues only: broken internal links, wrong locale
URLs, accidental English UI text, wrong lang/title/canonical/meta/OG values,
bad FAQ content, misleading claims, missing cross-links, or malformed HTML.
List actionable fixes or NONE. File: {path}\n\n{html}""")
        if audit.strip().upper() != "NONE":
            fixed = ask(client, f"""Fix ONLY these audited issues in {path}.
Preserve functionality, structure, CSS classes, IDs, scripts and real claims.
Audit:\n{audit}\n\nHTML:\n{html}\n\nReturn complete HTML only.""")
            fixed = re.sub(r"^```(?:html)?\s*|\s*```$","",fixed.strip())
            path.write_text(fixed+"\n", encoding="utf-8")

    marker = ROOT/".github"/"last_locale"
    marker.write_text(locale+"\n", encoding="utf-8")
    report = ROOT/".github"/"localization-research"
    report.mkdir(parents=True, exist_ok=True)
    (report/(locale+".md")).write_text("# "+country+" / "+language+"\n\n"+research+"\n", encoding="utf-8")
    print("Completed:", country, language, locale)

if __name__ == "__main__": main()