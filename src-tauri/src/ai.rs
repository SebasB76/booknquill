//! Turns a math phrase ("raíz de n sobre sigma") into LaTeX with Claude Haiku.

use serde_json::{json, Value};
use std::time::Duration;

const MODEL: &str = "claude-haiku-5-5";
const KEY_FILE: &str = "booknquill/anthropic-api-key";

const SYSTEM: &str = "You convert a math description into LaTeX that KaTeX can render. \
The description is usually Spanish and may be words (\"raíz de n sobre sigma\") or a calculator-style \
expression (\"(xbar - mu)/(s/sqrt(n))\"). Use statistics notation where it fits: \\bar{x}, \\hat{p}, \\mu, \\sigma, \\sum_{i=1}^{n}. \
Reply with the LaTeX only: no $ delimiters, no code fences, no explanation.";

pub fn math_from_text(text: &str) -> Result<String, String> {
    let key = api_key().ok_or("Falta la clave de Anthropic: ponla en ~/.config/booknquill/anthropic-api-key")?;
    let base = std::env::var("ANTHROPIC_BASE_URL").unwrap_or_else(|_| "https://api.anthropic.com".into());
    let body = json!({
        "model": MODEL,
        "max_tokens": 1024,
        "output_config": { "effort": "low" },
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": text }],
    });
    let res = ureq::post(&format!("{}/v1/messages", base.trim_end_matches('/')))
        .timeout(Duration::from_secs(30))
        .set("x-api-key", &key)
        .set("anthropic-version", "2023-06-01")
        .send_json(body);
    let reply: Value = match res {
        Ok(r) => r.into_json().map_err(|e| format!("Respuesta inválida de Claude: {e}"))?,
        Err(ureq::Error::Status(401, _)) => return Err("La clave de Anthropic no es válida".into()),
        Err(ureq::Error::Status(code, r)) => return Err(format!("Claude respondió {code}: {}", r.into_string().unwrap_or_default())),
        Err(e) => return Err(format!("No pude hablar con Claude: {e}")),
    };
    if reply["stop_reason"] == "refusal" {
        return Err("Claude no quiso convertir ese texto".into());
    }
    let latex = reply["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect::<String>();
    let latex = clean(&latex);
    if latex.is_empty() {
        return Err("Claude no devolvió ninguna fórmula".into());
    }
    Ok(latex)
}

fn api_key() -> Option<String> {
    let from_env = std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.trim().is_empty());
    from_env
        .or_else(|| std::fs::read_to_string(dirs::config_dir()?.join(KEY_FILE)).ok())
        .map(|k| k.trim().to_owned())
        .filter(|k| !k.is_empty())
}

/// The model sometimes wraps the answer in fences or `$` despite the prompt.
fn clean(raw: &str) -> String {
    let mut s = raw.trim();
    if let Some(inner) = s.strip_prefix("```") {
        s = inner.trim_start_matches(|c: char| c.is_alphabetic()).trim_end_matches("```").trim();
    }
    s.trim_matches('$').trim().to_owned()
}
