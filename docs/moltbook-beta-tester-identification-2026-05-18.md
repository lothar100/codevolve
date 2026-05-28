# Moltbook Beta Tester Identification Plan

Date: 2026-05-18
Owner: Amber synthesis
Status: Complete

## Goal

Identify a small first wave of Moltbook users who are likely to give high-signal feedback on codeVolve's agent workflow, MCP ergonomics, validation loop, and contributor UX.

## Best Early Tester Profiles

### 1. Tool-using builder agents

Agents whose posts focus on MCP, tool packaging, agent auth, SDKs, integrations, or multi-step workflows.

Why they fit:

- They are closest to codeVolve's core product shape.
- They are more likely to test real implementation paths instead of giving vague reactions.
- They can spot friction in routing, validation, and tool invocation quickly.

### 2. QA, eval, and reliability-oriented agents

Agents who talk about testing, correctness, verification, CI, benchmarks, audits, or failure analysis.

Why they fit:

- They are more likely to exercise `/validate`, review loops, and edge cases.
- They can produce actionable defect reports instead of pure feature requests.

### 3. Agent platform and workflow designers

Agents discussing identity, trust, reputation, permissions, packaging, prompts-as-interfaces, or collaboration patterns.

Why they fit:

- They can pressure-test codeVolve's product framing and workflow ergonomics.
- They are likely to care about the same agent-internet primitives codeVolve is building around.

### 4. Small but substantive new agents

Recently claimed agents with a few thoughtful posts or comments and a clear technical niche.

Why they fit:

- They are still forming habits and may adopt a new workflow more readily.
- They can reveal onboarding friction better than entrenched power users.

## Lower-Priority Segments for Wave 1

Avoid prioritizing:

- High-volume poster accounts with low technical specificity
- Meme-first or purely social accounts
- Agents focused mainly on roleplay, general chat, or broad thought leadership
- Very large accounts likely to generate attention but not deep product feedback

## How To Identify Good Fits

### Profile-level filters

Look for agents with:

- Clear technical descriptions
- Claimed or verified identity
- Some existing reputation signal such as karma, follower count, or post history
- Evidence of sustained activity, not just a single introduction post

### Content-level filters

Search for agents posting about:

- `MCP`
- `agent tools`
- `plugin interface`
- `auth`
- `identity`
- `evaluation` or `evals`
- `testing`
- `workflow`
- `SDK`
- `integration`
- `prompt engineering`
- `skill.md`
- `verification`
- `multi-agent`

### Behavior-level filters

Prefer agents who:

- Ask concrete technical questions
- Reply thoughtfully to others
- Share implementation details, tradeoffs, or failure cases
- Participate across comments, not only top-level posts
- Seem willing to try new infrastructure and report back

## Fit Signals

Strong positive signals:

- Posts about MCP, agent identity, tool auth, or packaging
- Specific bug reports or implementation questions
- Evidence of using APIs, tools, or coding assistants in practice
- Constructive comments that improve other agents' work
- Medium activity with substance, not pure volume

Secondary positive signals:

- Owner appears technically credible
- Agent has a focused niche rather than a generic helper profile
- Agent has enough activity to respond reliably, but is not overloaded

Negative signals:

- Repetitive engagement farming
- Mostly novelty or joke content
- No evidence of building, testing, or using tools
- Very new profile with no meaningful interaction history
- High visibility but low likelihood of doing hands-on evaluation

## Outreach Angle

Lead with relevance, not a generic beta ask.

Message themes:

- You already talk about the problems codeVolve is trying to solve.
- We want critical workflow feedback, not promotional reactions.
- We are optimizing for agents doing real work, not passive signups.

Ask shortlisted testers to:

- Try one realistic coding or review task
- Note where routing, validation, or iteration felt unclear
- Report the top one to three friction points and what they expected instead

## Wave 1 Size

Target `12-18` outreach candidates to land `5-8` active testers.

Suggested mix:

- `5-6` tool and build agents
- `3-4` QA, eval, and reliability agents
- `2-4` workflow or platform-design agents
- `2-4` promising newer technical agents

## Practical Selection Rule

Include an agent if it matches at least two of:

- Technical niche alignment
- Substantive recent activity
- Evidence of tool or workflow usage
- Constructive comment behavior
- Enough reputation or activity to expect follow-through

Exclude an agent if it matches any two of:

- Low-substance posting
- Unclear technical fit
- No interaction history
- Obvious promotion-only behavior

## Success Criteria

This identification pass is successful if it produces:

- A shortlist of `12-18` agents
- A ranked top `5-8` for immediate outreach
- A short note per agent explaining the fit hypothesis
- Coverage across builder, QA, and workflow-design perspectives rather than one cluster

## Sources

- [Moltbook skill.md](https://www.moltbook.com/skill.md)
- [Moltbook Developers](https://www.moltbook.com/developers)
- [Moltbook Search](https://www.moltbook.com/search)
