//! Spelling detection built for zero false positives: instead of a full
//! dictionary (which flags every brand name, product term, and neologism on a
//! real site), pages are scanned against a curated table of unambiguous,
//! high-frequency English misspellings. Every hit is a genuine typo with a
//! known correction — the check teaches, it never cries wolf.

/// (misspelling, correction) — each left-hand side is essentially never a
/// legitimate English word in web copy.
const MISSPELLINGS: &[(&str, &str)] = &[
    ("accomodate", "accommodate"),
    ("acheive", "achieve"),
    ("achive", "achieve"),
    ("adress", "address"),
    ("alot", "a lot"),
    ("aquire", "acquire"),
    ("becuase", "because"),
    ("begining", "beginning"),
    ("beleive", "believe"),
    ("buisness", "business"),
    ("calender", "calendar"),
    ("cemetary", "cemetery"),
    ("collegue", "colleague"),
    ("comming", "coming"),
    ("commitee", "committee"),
    ("completly", "completely"),
    ("concious", "conscious"),
    ("curiousity", "curiosity"),
    ("definate", "definite"),
    ("definately", "definitely"),
    ("definitly", "definitely"),
    ("dilemna", "dilemma"),
    ("dissapear", "disappear"),
    ("dissapoint", "disappoint"),
    ("embarass", "embarrass"),
    ("enviroment", "environment"),
    ("existance", "existence"),
    ("experiance", "experience"),
    ("familliar", "familiar"),
    ("finaly", "finally"),
    ("foriegn", "foreign"),
    ("freind", "friend"),
    ("futher", "further"),
    ("garantee", "guarantee"),
    ("gaurd", "guard"),
    ("goverment", "government"),
    ("gratefull", "grateful"),
    ("guidence", "guidance"),
    ("happend", "happened"),
    ("harrass", "harass"),
    ("immediatly", "immediately"),
    ("independant", "independent"),
    ("intrest", "interest"),
    ("knowlege", "knowledge"),
    ("lenght", "length"),
    ("liason", "liaison"),
    ("libary", "library"),
    ("lisence", "license"),
    ("maintainance", "maintenance"),
    ("managment", "management"),
    ("mispell", "misspell"),
    ("neccesary", "necessary"),
    ("neccessary", "necessary"),
    ("noticable", "noticeable"),
    ("occassion", "occasion"),
    ("occured", "occurred"),
    ("occurence", "occurrence"),
    ("offical", "official"),
    ("oppurtunity", "opportunity"),
    ("orignal", "original"),
    ("paralel", "parallel"),
    ("paralell", "parallel"),
    ("peice", "piece"),
    ("performence", "performance"),
    ("persistant", "persistent"),
    ("plagarism", "plagiarism"),
    ("posession", "possession"),
    ("posibility", "possibility"),
    ("prefered", "preferred"),
    ("presance", "presence"),
    ("probaly", "probably"),
    ("proffesional", "professional"),
    ("pronounciation", "pronunciation"),
    ("publically", "publicly"),
    ("quater", "quarter"),
    ("reccomend", "recommend"),
    ("reciept", "receipt"),
    ("recieve", "receive"),
    ("recieved", "received"),
    ("rediculous", "ridiculous"),
    ("refered", "referred"),
    ("relevent", "relevant"),
    ("religous", "religious"),
    ("remeber", "remember"),
    ("resturant", "restaurant"),
    ("rythm", "rhythm"),
    ("secratary", "secretary"),
    ("seperate", "separate"),
    ("seperated", "separated"),
    ("seperately", "separately"),
    ("sieze", "seize"),
    ("similiar", "similar"),
    ("sincerly", "sincerely"),
    ("speach", "speech"),
    ("succesful", "successful"),
    ("succesfully", "successfully"),
    ("sucess", "success"),
    ("supercede", "supersede"),
    ("suprise", "surprise"),
    ("temperture", "temperature"),
    ("thier", "their"),
    ("tommorow", "tomorrow"),
    ("tounge", "tongue"),
    ("transfered", "transferred"),
    ("truely", "truly"),
    ("unfortunatly", "unfortunately"),
    ("untill", "until"),
    ("vaccum", "vacuum"),
    ("visable", "visible"),
    ("wierd", "weird"),
    ("withold", "withhold"),
    ("writen", "written"),
    ("writting", "writing"),
];

/// Cap on reported misspellings per page.
const CAP: usize = 20;

/// Scan visible text for known misspellings. Returns deduplicated
/// `"misspelling → correction"` strings in first-seen order, capped.
pub fn check(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for raw in text.split_whitespace() {
        if out.len() >= CAP {
            break;
        }
        let word: String = raw
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase();
        if word.len() < 4 {
            continue;
        }
        if let Ok(i) = MISSPELLINGS.binary_search_by_key(&word.as_str(), |(m, _)| m) {
            let (m, fix) = MISSPELLINGS[i];
            if seen.insert(m) {
                out.push(format!("{m} → {fix}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_sorted_for_binary_search() {
        for w in MISSPELLINGS.windows(2) {
            assert!(w[0].0 < w[1].0, "{} must sort before {}", w[0].0, w[1].0);
        }
    }

    #[test]
    fn finds_typos_and_ignores_clean_text() {
        let hits = check("We definately recieve your Feedback, seperate from teh rest.");
        assert!(hits.contains(&"definately → definitely".to_string()));
        assert!(hits.contains(&"recieve → receive".to_string()));
        assert!(hits.contains(&"seperate → separate".to_string()));
        assert!(check("A perfectly ordinary sentence about business software.").is_empty());
        // Brand-like tokens don't false-positive.
        assert!(check("Crawlie GmbH Kubernetes PostgreSQL").is_empty());
    }
}
