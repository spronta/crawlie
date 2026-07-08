//! Dump the rule knowledge base as JSON — used to regenerate the desktop
//! bundle at `apps/desktop/src/lib/rules.json`:
//!
//! ```sh
//! cargo run -p crawlie-core --example dump_rules > apps/desktop/src/lib/rules.json
//! ```

fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&crawlie_core::knowledge::all_rules()).unwrap()
    );
}
