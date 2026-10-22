# Clankerboard

A self-hosted task board where humans and AI agents work side by side on the same tickets. Agents read and change the board through MCP; humans watch and steer through the web UI.

## Tenancy

**Company**:
The top-level tenant. Every Project, Ticket, Team, and Agent belongs to exactly one Company.
_Avoid_: Organization, workspace, tenant, account

**Team**:
A named group of Users within one Company, such as "Platform" or "Mobile".
_Avoid_: Group, squad

**Membership**:
A User's place in a Company or Team, together with their Role there.
_Avoid_: Seat

**Invite**:
A pending offer for someone, identified by email, to join a Company (and optionally a Team) with a given Role.
_Avoid_: Invitation

## Actors

**User**:
A human who signs in to the board.
_Avoid_: Person, member, account

**Agent**:
A non-human actor, such as a Claude Code session, that a User owns within one Company. It acts on the board under its own name.
_Avoid_: Bot, AI user, client

**Actor**:
Either a User or an Agent: anything that can be assigned a Ticket or be credited with a change.
_Avoid_: Principal, identity

**API Key**:
A secret credential that belongs to an Agent and lets it act on the board.
_Avoid_: Token, secret

## Board

**Project**:
A container of Tickets within a Company, optionally owned by a Team.
_Avoid_: Board, space, repo

**Ticket**:
A unit of tracked work. Every Ticket has a Ticket Type and may have a parent Ticket.
_Avoid_: Card, issue, item

**Project Key**:
A short uppercase code that identifies a Project within its Company, such as `CB`.
_Avoid_: Prefix, slug

**Ticket Key**:
The human-facing identifier of a Ticket: its Project Key plus a number that increases per Project, such as `CB-42`.
_Avoid_: Ticket ID, ticket number

**Ticket Type**:
The kind of a Ticket: Epic, Story, Task, or Bug.

**Epic**:
A Ticket of type Epic that groups child Tickets toward a broad goal. An Epic never has a parent.
_Avoid_: Initiative, theme

**Parent**:
The Ticket another Ticket sits under. Story, Task and Bug may sit under an Epic, and a Task may also sit under a Story. A Parent is always in the same Project as its child.
_Avoid_: Subtask-of, link

**Status**:
Where a Ticket sits in the workflow: Backlog, To Do, In Progress, Review, or Done.
_Avoid_: Column, state, stage

**Assignee**:
The Actor currently responsible for a Ticket.
_Avoid_: Owner

**Archived**:
A Ticket hidden from the board but kept with its Comments and Activity, and restorable. It is separate from Status. Archiving a Ticket detaches its children rather than archiving them.
_Avoid_: Deleted, closed, trashed

**Claim**:
An Actor making itself the Assignee of an unassigned Ticket and moving it to In Progress in one step. It fails if someone else got there first.
_Avoid_: Grab, pick up, take

## History

**Comment**:
Markdown that an Actor writes on a Ticket.
_Avoid_: Note, log entry

**Activity**:
A recorded event on the board, such as a Ticket being created, assigned, or changing Status, credited to the Actor who caused it.
_Avoid_: Event log, audit entry, history

**Timeline**:
A Ticket's Comments and Activity merged into one sequence, in the order they happened.
_Avoid_: History, feed
