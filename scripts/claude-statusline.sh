#!/bin/bash
# Claude Code status line for the api-costs dashboard.
#
# Claude Code pipes session JSON to this script on every status line refresh. For
# claude.ai Pro/Max logins that JSON carries `rate_limits` (5-hour and 7-day usage),
# which this script records to a state file the dashboard reads. It also prints a
# one-line status: model, context used, 5-hour and weekly plan usage.
#
# Wire it into a Claude Code settings file (e.g. ~/.claude/settings.local.json) with an
# absolute path, for every config dir you use (CLAUDE_CONFIG_DIR):
#   "statusLine": {"type": "command", "command": "/abs/path/to/api-costs/scripts/claude-statusline.sh"}
#
# Several sessions write the same file, and an idle session re-sends its old numbers,
# so readings are MERGED: per window the later resets_at wins, then the higher
# used_percentage (usage only rises within a window). updated_at changes only when the
# stored value changes. Must stay fast and must never fail loudly: a non-zero exit or
# stderr would blank the status line.

input=$(cat)
state_dir="${AI_USAGE_STATE_DIR:-$HOME/.local/state/ai-usage}"
state="$state_dir/claude-rate-limits.json"

if printf '%s' "$input" | jq -e '.rate_limits | type == "object"' >/dev/null 2>&1; then
  mkdir -p "$state_dir" 2>/dev/null
  tmp=$(mktemp "$state_dir/.claude-rate-limits.XXXXXX" 2>/dev/null)
  if [ -n "$tmp" ]; then
    old='{}'
    if [ -s "$state" ] && jq -e 'type == "object"' "$state" >/dev/null 2>&1; then
      old=$(cat "$state")
    fi
    if printf '%s' "$input" | jq --argjson old "$old" --argjson now "$(date +%s)" '
      def pick($a; $b):
        if $a == null then $b
        elif $b == null then $a
        elif ($b.resets_at // 0) > ($a.resets_at // 0) then $b
        elif ($b.resets_at // 0) < ($a.resets_at // 0) then $a
        elif ($b.used_percentage // 0) > ($a.used_percentage // 0) then $b
        else $a end;
      .rate_limits as $new
      | reduce ("five_hour", "seven_day") as $k ({windows: ($old.windows // {})};
          ($new[$k] | if type == "object" and (.used_percentage | type) == "number"
                      then {used_percentage, resets_at, updated_at: $now} else null end) as $b
          | pick(.windows[$k]; $b) as $w
          | if $w == null then . else .windows[$k] = $w end)
      | .written_at = $now
    ' >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
      mv -f "$tmp" "$state" 2>/dev/null || rm -f "$tmp"
    else
      rm -f "$tmp"
    fi
  fi
fi

printf '%s' "$input" | jq -r '
  def pct: if type == "number" then "\(. | round)%" else empty end;
  [ (.model.display_name // empty),
    (.context_window.used_percentage | pct | "ctx \(.)"),
    (.rate_limits.five_hour.used_percentage | pct | "5h \(.)"),
    (.rate_limits.seven_day.used_percentage | pct | "week \(.)")
  ] | join("  ")
' 2>/dev/null
exit 0
