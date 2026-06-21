//! The built-in slop pack, shipped as a `.crawlie` file and embedded at compile
//! time. It is *not* privileged — it is authored in exactly the same language a
//! user or agent writes, and is meant to be copied and tuned.

use crate::pack::RulePack;
use crate::parse;

/// The source of the default slop pack (editable; this is the canonical copy).
pub const SLOP_DEFAULT_SRC: &str = include_str!("../packs/slop-default.crawlie");

/// Parse and return the built-in slop pack. Infallible in practice — the pack
/// ships with the crate and is covered by a test — but returns a `Result` so
/// callers can surface a clear error if the embedded file is ever broken.
pub fn default_pack() -> Result<RulePack, parse::ParseError> {
    parse::load("slop-default", SLOP_DEFAULT_SRC)
}
