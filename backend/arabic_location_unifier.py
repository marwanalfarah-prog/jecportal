import streamlit as st
import openai
import json
import re

# ── Page config ────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="التعريب الجغرافي · Arabic Location Unifier",
    page_icon="🌍",
    layout="centered",
)

# ── Custom CSS ─────────────────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

html, body, [class*="css"] {
    font-family: 'IBM Plex Mono', monospace;
}

.arabic-title {
    font-family: 'Amiri', serif;
    font-size: 2.6rem;
    color: #1a0a00;
    direction: rtl;
    text-align: right;
    line-height: 1.3;
    margin-bottom: 0;
}
.subtitle {
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: #9a7c5a;
    text-transform: uppercase;
    margin-bottom: 1.5rem;
}
.result-card {
    background: #fffaf3;
    border: 1px solid #e0ceaf;
    border-radius: 8px;
    padding: 1.4rem 1.6rem;
    margin-top: 1.2rem;
}
.result-label {
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    color: #8b7355;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 0.3rem;
}
.result-input {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 0.82rem;
    color: #3d2b1f;
    margin-bottom: 0.3rem;
}
.arabic-name {
    font-family: 'Amiri', serif;
    font-size: 1.9rem;
    color: #1a0a00;
    direction: rtl;
    text-align: right;
    background: #fdf6ec;
    padding: 0.5rem 0.9rem;
    border-radius: 4px;
    border: 1px solid #e8dcc8;
    margin: 0.4rem 0;
}
.badge-exists {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
    margin-left: 8px;
}
.badge-missing {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
    margin-left: 8px;
}
.note-text {
    font-size: 0.72rem;
    color: #9a7c5a;
    font-style: italic;
    margin-top: 0.25rem;
}
.summary-box {
    background: #f5ede0;
    border: 1px solid #d4b896;
    border-radius: 6px;
    padding: 1rem 1.2rem;
    margin-top: 1rem;
}
.summary-arabic {
    font-family: 'Amiri', serif;
    font-size: 1.6rem;
    color: #1a0a00;
    direction: rtl;
    text-align: right;
    line-height: 1.7;
}
.divider {
    border: none;
    border-top: 1px solid #e8dcc8;
    margin: 1rem 0;
}
.footer {
    text-align: center;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    color: #c0a882;
    text-transform: uppercase;
    margin-top: 2rem;
}
</style>
""", unsafe_allow_html=True)


# ── Header ─────────────────────────────────────────────────────────────────────
st.markdown('<div class="arabic-title">التعريب الجغرافي</div>', unsafe_allow_html=True)
st.markdown('<div class="subtitle">Geographic Arabic Name Unifier · Powered by GPT-4o-mini</div>', unsafe_allow_html=True)
st.markdown("Enter location names in **any language**. The AI will verify their existence and return their **official Arabic names**.")
st.markdown("---")


# ── API Key input ──────────────────────────────────────────────────────────────
with st.expander("🔑 OpenAI API Key", expanded=True):
    api_key = st.text_input(
        "Paste your OpenAI API key",
        type="password",
        placeholder="sk-proj-...",
        help="Your key is never stored or logged. It lives only in this session.",
    )


# ── Location inputs ────────────────────────────────────────────────────────────
st.markdown("### 📍 Location Details")

col1, col2 = st.columns([1, 1])
with col1:
    country = st.text_input("Country *", placeholder="e.g. Jordan, Germany, 日本")
with col2:
    state = st.text_input("State / Region", placeholder="e.g. Bavaria, Aqaba")

city = st.text_input("City", placeholder="e.g. Amman, Munich, New York")


# ── Helper functions ───────────────────────────────────────────────────────────
def build_prompt(country: str, state: str, city: str) -> str:
    parts = []
    if country.strip():
        parts.append(f"Country: {country.strip()}")
    if state.strip():
        parts.append(f"State/Region: {state.strip()}")
    if city.strip():
        parts.append(f"City: {city.strip()}")
    location_block = "\n".join(parts)

    return f"""You are a geographic data expert with deep knowledge of Arabic naming conventions.

Given the following location input (which may be in English, Arabic, or any language):
{location_block}

Please do the following:
1. Verify whether each provided location actually exists (country, state/region, city).
2. If a location does not exist or is misspelled, note it clearly.
3. For each valid location, provide its OFFICIAL Arabic name as used by the country/region itself (the real Arabic name, not just a transliteration).

Respond ONLY with a valid JSON object — no markdown, no explanation — in this exact structure:
{{
  "country": {{
    "input": "<what user typed>",
    "exists": true or false,
    "official_arabic": "<official Arabic name or null>",
    "note": "<optional correction or note, or null>"
  }},
  "state": {{
    "input": "<what user typed, or null if not provided>",
    "exists": true or false or null,
    "official_arabic": "<official Arabic name or null>",
    "note": "<optional correction or note, or null>"
  }},
  "city": {{
    "input": "<what user typed, or null if not provided>",
    "exists": true or false or null,
    "official_arabic": "<official Arabic name or null>",
    "note": "<optional correction or note, or null>"
  }},
  "summary": "<one sentence in Arabic summarising the full unified location name>"
}}"""


def call_openai(api_key: str, prompt: str) -> dict:
    client = openai.OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=800,
    )
    raw = response.choices[0].message.content or ""
    # Strip any accidental markdown fences
    clean = re.sub(r"```(?:json)?|```", "", raw).strip()
    return json.loads(clean)


def render_location_row(label: str, data: dict):
    if not data or data.get("input") is None:
        return
    exists = data.get("exists")
    if exists is None:
        return  # not provided by user

    badge = (
        '<span class="badge-exists">✓ EXISTS</span>'
        if exists
        else '<span class="badge-missing">✗ NOT FOUND</span>'
    )
    arabic = data.get("official_arabic") or ""
    note = data.get("note") or ""

    arabic_html = f'<div class="arabic-name">{arabic}</div>' if arabic and exists else ""
    note_html = f'<div class="note-text">⚠ {note}</div>' if note else ""

    st.markdown(f"""
    <div class="result-card">
        <div class="result-label">{label}</div>
        <div class="result-input">{data.get('input', '')} {badge}</div>
        {arabic_html}
        {note_html}
    </div>
    """, unsafe_allow_html=True)


# ── Submit ─────────────────────────────────────────────────────────────────────
run = st.button("🔍 Identify Arabic Names", use_container_width=True, type="primary")

if run:
    if not api_key.strip():
        st.error("Please enter your OpenAI API key above.")
    elif not country.strip():
        st.error("Country is required.")
    else:
        with st.spinner("Verifying locations and translating to Arabic..."):
            try:
                prompt = build_prompt(country, state, city)
                result = call_openai(api_key.strip(), prompt)

                st.success("Done! Here are the official Arabic names:")

                render_location_row("🌍 Country", result.get("country"))
                render_location_row("🗺 State / Region", result.get("state"))
                render_location_row("🏙 City", result.get("city"))

                summary = result.get("summary", "")
                if summary:
                    st.markdown(f"""
                    <div class="summary-box">
                        <div class="result-label">📋 Full Location Summary in Arabic</div>
                        <div class="summary-arabic">{summary}</div>
                    </div>
                    """, unsafe_allow_html=True)

            except json.JSONDecodeError:
                st.error("The model returned an unexpected response. Please try again.")
            except openai.AuthenticationError:
                st.error("Invalid API key. Please check your OpenAI key and try again.")
            except openai.RateLimitError:
                st.error("Rate limit reached. Please wait a moment and try again.")
            except openai.OpenAIError as e:
                st.error(f"OpenAI API error: {e}")
            except Exception as e:
                st.error(f"Unexpected error: {e}")


# ── Footer ─────────────────────────────────────────────────────────────────────
st.markdown('<div class="footer">Powered by OpenAI GPT-4o-mini</div>', unsafe_allow_html=True)
