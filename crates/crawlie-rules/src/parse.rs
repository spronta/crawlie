//! Parser for the `.crawlie` rule-pack language.
//!
//! The grammar is deliberately tiny — a sequence of rule-constructor calls with
//! keyword arguments — so it is trivial for a human to edit and for an agent to
//! write. Comments start with `#`. Example:
//!
//! ```text
//! # slop.crawlie
//! phrase_rule("ai-cliches", weight = 3, phrases = [
//!     "in today's fast-paced world", "unlock the power of",
//! ])
//! regex_rule("rule-of-three", weight = 2, pattern = "\\w+, \\w+,? and \\w+")
//! metric_rule("low-burstiness", weight = 2,
//!     metric = sentence_variance(), when = below(15))
//! ```
//!
//! Errors are structured ([`ParseError`] is `Serialize`) with line/column so an
//! authoring agent can read the failure and patch the file without guessing.

use crate::pack::RulePack;
use crate::rule::{Comparator, Metric, Rule, RuleKind};
use serde::Serialize;

/// A structured parse/build error: machine-readable for agents, readable for
/// humans.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseError {
    pub line: usize,
    pub col: usize,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}: {}", self.line, self.col, self.message)
    }
}
impl std::error::Error for ParseError {}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Ident(String),
    Str(String),
    Num(f64),
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
    Eq,
}

#[derive(Debug, Clone)]
struct Spanned {
    tok: Tok,
    line: usize,
    col: usize,
}

fn lex(src: &str) -> Result<Vec<Spanned>, ParseError> {
    let mut out = Vec::new();
    let mut line = 1;
    let mut col = 1;
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;

    let err = |line, col, message: String| ParseError { line, col, message };

    while i < chars.len() {
        let c = chars[i];
        match c {
            '\n' => {
                line += 1;
                col = 1;
                i += 1;
            }
            c if c.is_whitespace() => {
                col += 1;
                i += 1;
            }
            '#' => {
                // comment to end of line
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '(' => {
                out.push(Spanned {
                    tok: Tok::LParen,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            ')' => {
                out.push(Spanned {
                    tok: Tok::RParen,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            '[' => {
                out.push(Spanned {
                    tok: Tok::LBracket,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            ']' => {
                out.push(Spanned {
                    tok: Tok::RBracket,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            ',' => {
                out.push(Spanned {
                    tok: Tok::Comma,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            '=' => {
                out.push(Spanned {
                    tok: Tok::Eq,
                    line,
                    col,
                });
                col += 1;
                i += 1;
            }
            '"' | '\'' => {
                let quote = c;
                let start_line = line;
                let start_col = col;
                i += 1;
                col += 1;
                let mut s = String::new();
                let mut closed = false;
                while i < chars.len() {
                    let ch = chars[i];
                    if ch == '\\' && i + 1 < chars.len() {
                        let next = chars[i + 1];
                        s.push(match next {
                            'n' => '\n',
                            't' => '\t',
                            'r' => '\r',
                            other => other, // \" \\ \' and any literal escape
                        });
                        i += 2;
                        col += 2;
                        continue;
                    }
                    if ch == quote {
                        closed = true;
                        i += 1;
                        col += 1;
                        break;
                    }
                    if ch == '\n' {
                        line += 1;
                        col = 1;
                    } else {
                        col += 1;
                    }
                    s.push(ch);
                    i += 1;
                }
                if !closed {
                    return Err(err(start_line, start_col, "unterminated string".into()));
                }
                out.push(Spanned {
                    tok: Tok::Str(s),
                    line: start_line,
                    col: start_col,
                });
            }
            c if c.is_ascii_digit()
                || (c == '-' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) =>
            {
                let start_col = col;
                let mut num = String::new();
                if c == '-' {
                    num.push('-');
                    i += 1;
                    col += 1;
                }
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    num.push(chars[i]);
                    i += 1;
                    col += 1;
                }
                let val: f64 = num
                    .parse()
                    .map_err(|_| err(line, start_col, format!("invalid number `{num}`")))?;
                out.push(Spanned {
                    tok: Tok::Num(val),
                    line,
                    col: start_col,
                });
            }
            c if c.is_alphabetic() || c == '_' => {
                let start_col = col;
                let mut id = String::new();
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    id.push(chars[i]);
                    i += 1;
                    col += 1;
                }
                out.push(Spanned {
                    tok: Tok::Ident(id),
                    line,
                    col: start_col,
                });
            }
            other => {
                return Err(err(line, col, format!("unexpected character `{other}`")));
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Value tree
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Value {
    Str(String),
    Num(f64),
    List(Vec<Value>),
    Call { name: String, args: Vec<Arg> },
}

#[derive(Debug, Clone)]
struct Arg {
    name: Option<String>,
    value: Value,
}

struct Parser {
    toks: Vec<Spanned>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Spanned> {
        self.toks.get(self.pos)
    }

    fn loc(&self) -> (usize, usize) {
        match self.toks.get(self.pos) {
            Some(s) => (s.line, s.col),
            // At EOF, point at the last token we saw (or the start of the file).
            None => self.toks.last().map(|s| (s.line, s.col)).unwrap_or((1, 1)),
        }
    }

    fn err(&self, message: impl Into<String>) -> ParseError {
        let (line, col) = self.loc();
        ParseError {
            line,
            col,
            message: message.into(),
        }
    }

    fn bump(&mut self) -> Option<Spanned> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    fn expect(&mut self, want: &Tok) -> Result<(), ParseError> {
        match self.peek() {
            Some(s) if &s.tok == want => {
                self.pos += 1;
                Ok(())
            }
            _ => Err(self.err(format!("expected `{want:?}`"))),
        }
    }

    /// Parse a call: `IDENT ( args? )`. Assumes the next token is the IDENT.
    fn parse_call(&mut self) -> Result<Value, ParseError> {
        let name = match self.bump() {
            Some(Spanned {
                tok: Tok::Ident(id),
                ..
            }) => id,
            _ => return Err(self.err("expected an identifier")),
        };
        self.expect(&Tok::LParen)?;
        let mut args = Vec::new();
        if !matches!(
            self.peek(),
            Some(Spanned {
                tok: Tok::RParen,
                ..
            })
        ) {
            loop {
                args.push(self.parse_arg()?);
                match self.peek() {
                    Some(Spanned {
                        tok: Tok::Comma, ..
                    }) => {
                        self.pos += 1;
                        // allow trailing comma
                        if matches!(
                            self.peek(),
                            Some(Spanned {
                                tok: Tok::RParen,
                                ..
                            })
                        ) {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        }
        self.expect(&Tok::RParen)?;
        Ok(Value::Call { name, args })
    }

    fn parse_arg(&mut self) -> Result<Arg, ParseError> {
        // keyword arg?  IDENT '=' value
        if let Some(Spanned {
            tok: Tok::Ident(id),
            ..
        }) = self.peek().cloned()
        {
            if matches!(
                self.toks.get(self.pos + 1),
                Some(Spanned { tok: Tok::Eq, .. })
            ) {
                self.pos += 2; // consume IDENT and '='
                let value = self.parse_value()?;
                return Ok(Arg {
                    name: Some(id),
                    value,
                });
            }
        }
        let value = self.parse_value()?;
        Ok(Arg { name: None, value })
    }

    fn parse_value(&mut self) -> Result<Value, ParseError> {
        match self.peek().cloned() {
            Some(Spanned {
                tok: Tok::Str(s), ..
            }) => {
                self.pos += 1;
                Ok(Value::Str(s))
            }
            Some(Spanned {
                tok: Tok::Num(n), ..
            }) => {
                self.pos += 1;
                Ok(Value::Num(n))
            }
            Some(Spanned {
                tok: Tok::LBracket, ..
            }) => self.parse_list(),
            Some(Spanned {
                tok: Tok::Ident(_), ..
            }) => self.parse_call(),
            _ => Err(self.err("expected a string, number, list, or call")),
        }
    }

    fn parse_list(&mut self) -> Result<Value, ParseError> {
        self.expect(&Tok::LBracket)?;
        let mut items = Vec::new();
        if !matches!(
            self.peek(),
            Some(Spanned {
                tok: Tok::RBracket,
                ..
            })
        ) {
            loop {
                items.push(self.parse_value()?);
                match self.peek() {
                    Some(Spanned {
                        tok: Tok::Comma, ..
                    }) => {
                        self.pos += 1;
                        if matches!(
                            self.peek(),
                            Some(Spanned {
                                tok: Tok::RBracket,
                                ..
                            })
                        ) {
                            break;
                        }
                    }
                    _ => break,
                }
            }
        }
        self.expect(&Tok::RBracket)?;
        Ok(Value::List(items))
    }
}

// ---------------------------------------------------------------------------
// Arg helpers
// ---------------------------------------------------------------------------

fn arg<'a>(args: &'a [Arg], name: &str, pos: Option<usize>) -> Option<&'a Value> {
    if let Some(a) = args.iter().find(|a| a.name.as_deref() == Some(name)) {
        return Some(&a.value);
    }
    // fall back to a positional (un-named) arg at index `pos`
    if let Some(p) = pos {
        return args
            .iter()
            .filter(|a| a.name.is_none())
            .nth(p)
            .map(|a| &a.value);
    }
    None
}

fn as_str(v: &Value) -> Result<String, String> {
    match v {
        Value::Str(s) => Ok(s.clone()),
        _ => Err("expected a string".into()),
    }
}
fn as_num(v: &Value) -> Result<f64, String> {
    match v {
        Value::Num(n) => Ok(*n),
        _ => Err("expected a number".into()),
    }
}
fn as_str_list(v: &Value) -> Result<Vec<String>, String> {
    match v {
        Value::List(items) => items.iter().map(as_str).collect(),
        _ => Err("expected a list of strings".into()),
    }
}

fn build_metric(v: &Value) -> Result<Metric, String> {
    let Value::Call { name, args } = v else {
        return Err("expected a metric like `sentence_variance()`".into());
    };
    Ok(match name.as_str() {
        "sentence_variance" => Metric::SentenceVariance,
        "em_dash_density" => Metric::EmDashDensity,
        "filler_ratio" => Metric::FillerRatio,
        "transition_ratio" => Metric::TransitionRatio,
        "lexical_diversity" => Metric::LexicalDiversity,
        "adverb_density" => Metric::AdverbDensity,
        "ngram_repetition" => {
            let n = arg(args, "n", Some(0)).ok_or("ngram_repetition(n) needs an argument")?;
            Metric::NgramRepetition(as_num(n)? as usize)
        }
        other => return Err(format!("unknown metric `{other}`")),
    })
}

fn build_comparator(v: &Value) -> Result<Comparator, String> {
    let Value::Call { name, args } = v else {
        return Err("expected a comparator like `below(15)`".into());
    };
    Ok(match name.as_str() {
        "below" => Comparator::Below(as_num(
            arg(args, "x", Some(0)).ok_or("below(x) needs a value")?,
        )?),
        "above" => Comparator::Above(as_num(
            arg(args, "x", Some(0)).ok_or("above(x) needs a value")?,
        )?),
        "between" => {
            let lo = as_num(arg(args, "lo", Some(0)).ok_or("between(lo, hi) needs two values")?)?;
            let hi = as_num(arg(args, "hi", Some(1)).ok_or("between(lo, hi) needs two values")?)?;
            Comparator::Between(lo, hi)
        }
        other => return Err(format!("unknown comparator `{other}`")),
    })
}

fn build_rule(name: &str, args: &[Arg]) -> Result<Rule, String> {
    let rule_name = as_str(arg(args, "name", Some(0)).ok_or("rule needs a name")?)?;
    let weight = match arg(args, "weight", None) {
        Some(v) => as_num(v)?,
        None => 1.0,
    };
    let kind = match name {
        "phrase_rule" => {
            let phrases = as_str_list(
                arg(args, "phrases", None).ok_or("phrase_rule needs `phrases = [...]`")?,
            )?;
            RuleKind::Phrase(phrases)
        }
        "regex_rule" => {
            let pattern =
                as_str(arg(args, "pattern", None).ok_or("regex_rule needs `pattern = \"...\"`")?)?;
            let re = regex::RegexBuilder::new(&pattern)
                .case_insensitive(true)
                .build()
                .map_err(|e| format!("invalid regex: {e}"))?;
            RuleKind::Regex(re)
        }
        "metric_rule" => {
            let metric =
                build_metric(arg(args, "metric", None).ok_or("metric_rule needs `metric = ...`")?)?;
            let when =
                build_comparator(arg(args, "when", None).ok_or("metric_rule needs `when = ...`")?)?;
            RuleKind::Metric { metric, when }
        }
        other => return Err(format!("unknown rule constructor `{other}`")),
    };
    Ok(Rule {
        name: rule_name,
        weight,
        kind,
    })
}

/// Parse `.crawlie` source into a [`RulePack`]. `pack_name` labels the result
/// (usually the file stem).
pub fn load(pack_name: impl Into<String>, src: &str) -> Result<RulePack, ParseError> {
    let toks = lex(src)?;
    let mut p = Parser { toks, pos: 0 };
    let mut rules = Vec::new();
    while p.peek().is_some() {
        let (line, col) = p.loc();
        let Value::Call { name, args } = p.parse_call()? else {
            return Err(ParseError {
                line,
                col,
                message: "expected a rule constructor".into(),
            });
        };
        let rule = build_rule(&name, &args).map_err(|message| ParseError { line, col, message })?;
        rules.push(rule);
    }
    Ok(RulePack::new(pack_name, rules))
}
