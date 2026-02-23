# Multiplayer Web Euchre - Requirements (v0.1)

## 1. Purpose
This document defines the initial goals and requirements for building a multiplayer, web-based Euchre game. It is intended to align product, engineering, and design decisions for the first release.

## 2. Product Vision
Build a fast, intuitive, and fair online Euchre experience where 4 players can reliably play full games in real time from desktop or mobile browsers.

## 3. Goals
1. Enable real-time multiplayer gameplay for standard 4-player, 2-team Euchre.
2. Invitation only play. Send a URL to friends to join a game.
3. Enforce Euchre rules consistently on the server.
4. Provide a responsive web UI that works on modern desktop and mobile browsers.
5. Make joining a game quick (minimal friction, shareable game link).

## 4. Non-Goals (Initial Release)
1. No public matchmaking.
2. No AI/bot opponents.
3. No tournament mode.
4. No native mobile apps (web only).
5. No voice/video chat.
6. No player lobby. 
7. No ranked matchmaking or ELO ladders.
8. No ranks, statistics, or game history

## 5. Target Users
1. A small group of invitation-only players who want to play with friends remotely.
2. Amateur euchre players who expect standard rules and smooth game flow.

## 6. Core User Stories
1. As a host, I can create a game and share a link so friends can join.
2. As a player, I can join a game, choose a display name, and be assigned a seat.
3. As a player, I can play cards only when legal by game rules.
4. As a player, I can see current trick, trump, score, dealer, and turn clearly.
5. As a player, I can finish a full game and see the winning team.
6. As a player, I can recover from a temporary disconnect without losing my seat.

## 7. Functional Requirements

### 7.1 Lobby and Session Management
1. Players can create a new game lobby and receive a unique join URL/code.
2. Lobby supports up to 4 connected players.
3. Host can start game when 4 players are present.
4. Players can set/change display names before game start.
5. System automatically assigns players to seats and teams.
6. Rejoin support via reconnect token/session so a disconnected player can reclaim seat.

### 7.2 Game Rules and Flow
1. Implement the exact MVP rule variant defined in `docs/rules_of_euchre.md`.
2. Use a 24-card Euchre deck (9, 10, J, Q, K, A in each suit) with no joker.
3. Deal, bidding/calling trump, optional going alone, trick-taking, and scoring are supported.
4. Rules engine validates legal plays (follow suit, left/right bower behavior, turn order).
5. Server is authoritative for game state and rule enforcement.
6. Round ends when 5 tricks complete; game ends when team reaches target score (default 10).
7. UI displays clear state transitions (deal, order up/pass, choose trump, play trick, score update, next deal).

### 7.3 Real-Time Multiplayer
1. Game state updates are pushed in real time to all players.
2. Turn actions are processed in order and broadcast consistently.
3. Late/duplicate client actions are rejected safely by server.

### 7.4 UX and Interface
1. Responsive layout for common mobile and desktop screen sizes.
2. Clear card presentation, selected card state, and legal/illegal action feedback.
3. Visible indicators for dealer, current turn, trump, lead suit, trick winner, and team scores.
4. Lightweight onboarding/help text for key Euchre-specific mechanics.

### 7.5 Reliability and Recovery
1. Temporary disconnect handling with reconnection window (target: at least 60 seconds).
2. In-progress game state persists long enough for reconnect (target: at least 15 minutes).
3. If a player fails to reconnect within the window, that player forfeits and the game ends in favor of the opposing team.

## 8. Non-Functional Requirements
1. Performance: player action to remote UI update typically under 300 ms on stable broadband.
2. Availability: game sessions should recover from single client refresh/disconnect.
3. Security: validate all client inputs server-side; protect session/join tokens.
4. Compatibility: latest two versions of major browsers (Chrome, Safari, Firefox, Edge).
5. Maintainability: clear separation of rules engine, real-time transport, and UI layers.
6. Observability: basic structured logs and error reporting for game/session events.

## 9. Product Metrics (Initial)
1. Time to join game from link: median under 30 seconds.
2. Completed games / started games: at least 80%.
3. Disconnect recovery success rate: at least 90% for reconnects within recovery window.
4. Rule error rate (invalid state incidents): 0 known critical issues in production.

## 10. Finalized Decisions (2026-02-23)
1. Rule variant for MVP follows `docs/rules_of_euchre.md` (24-card deck, no joker, standard bidding/play, optional going alone, game to 10 points).
2. Seat assignment is automatic.
3. Reconnect timeout behavior is forfeit.
4. MVP uses anonymous sessions only; no long-term user accounts are required.
5. Hosting should prioritize ease of deployment for a small audience (about 8 total players), over advanced scalability optimization.

## 11. MVP Scope Summary
Included in MVP:
1. 4-player private games
2. Full server-validated Euchre gameplay with scoring to game end.
3. Real-time play in browser with reconnect support.
4. Basic game UI and state indicators.

Excluded from MVP:
1. Public matchmaking.
2. Bots.
3. Rankings/stat history.
4. Social features beyond invite link and names.

## 12. Acceptance Criteria (MVP)
1. Four players can join one game, start game, and complete a full game to winning score.
2. All trick/bidding/scoring actions are validated server-side and synchronized across clients.
3. At least one disconnected player can reconnect and continue in same seat during an active game.
4. Game is playable on desktop and mobile browsers without blocking usability issues.
5. No critical rule-enforcement bugs in final validation pass.
