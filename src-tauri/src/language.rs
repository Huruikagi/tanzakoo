use serde::Deserialize;

/// Display language is supplied per request; saved user content is never translated.
#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Ja,
    En,
}

impl Language {
    pub fn choose<'a>(self, japanese: &'a str, english: &'a str) -> &'a str {
        match self {
            Self::Ja => japanese,
            Self::En => english,
        }
    }
}
