# Tanzakoo — Store review notes

This document is the English-only source for reviewer instructions. Before submission, supply the current review access code, its expiry, and a monitored support contact in the store's private review fields. Do not commit credentials to this document. Confirm these steps against the exact submitted build; this document does not record a completed store submission.

A [compact copy-ready draft](app-store/review-notes.txt) targets the current features at source `6c929b7`; enter the final signed version and build before use. Build 2 is an older build. The public support address approved by the developer is **huruikagi@gmail.com**. Enter actual reviewer contact details separately in App Store Connect. Replace the private code and expiry placeholders only in the submission fields, after checking remaining usage and availability.

## What the app does

Tanzakoo is a free, local desktop app for developing product ideas. Users organize ideas on a board, optionally discuss them with AI, and review proposed changes before applying them.

Project creation, card editing, archiving, project memory, and Markdown export work without an AI account. Ordinary AI use connects to the user's own eligible ChatGPT plan through Continue with ChatGPT and is subject to that account's plan and limits. The app being free does not make external AI usage unlimited or free.

The interface supports Japanese and English. Open the gear button (**Settings**) and set **Display language → English**. **System default** uses Japanese for a Japanese system language and English otherwise. Display language changes do not translate existing cards, project memory, or conversations. AI follows the user's requested language or the language of their messages.

## Review access

Review access provides real AI functionality using an expiring code supplied privately with the submission. The developer pays for this access. Reviewers do not need to enter an API key, configure a server URL, or sign in to a personal ChatGPT account.

1. Open **Settings** using the gear button. Alternatively, open **Think with AI → Connection status**.
2. Open the **AI connection** tab and select **Use review access**.
3. Enter the supplied **Review access code**.
4. Read the data-sharing explanation and select **I agree to send data through the relay server to OpenAI**.
5. Select **Agree and connect**. The connection panel displays the assigned model and expiry.
6. Open **Think with AI** and start a new conversation.

Checking the code does not send board, conversation, memory, or reference content and does not call an AI model. Sending a conversation shares its context, the current board, project memory, pending proposals, registered reference paths, and any reference excerpts read by AI through Tanzakoo's relay server to OpenAI.

The same local board, conversation, card tools, and approval controls are used for regular and review access. Differences are the developer-funded model connection, relay routing, an assigned model, and expiry/usage limits. Review access supports text and local card/reference tools; it does not provide image/file uploads, hosted web search, or remote MCP tools.

The code and review consent are retained only for the current app session and apply across projects. After restarting the app, enter the code and consent again. Cards and saved conversations remain available. **Return to regular connection** disconnects review access and withdraws its consent. Regular sign-in, consent, and model settings are preserved.

Switching connections starts a new conversation. An existing conversation must be resumed with its original connection; it is not silently sent to a different provider. An expired, revoked, or exhausted code does not delete local content or automatically switch to a personal account. Contact the support address provided with the submission for a replacement code or connection assistance.

## Suggested review walkthrough

1. **Manual use:** Create a project with the **New project** button beside the project selector. Add a card using **Card**, edit its title and content, and select **Save**. Move it between **Ideas**, **Exploring**, **Discussing**, and **Decided**. These actions require no AI connection.
2. **Conversation and card creation:** Connect with review access, then send: “I want to build a personal to-do app. Help me explore the idea and create three candidate cards.” New candidate cards should appear on the board.
3. **Proposals and approval:** Open a card, choose **Reference in chat**, and ask: “Propose a clearer title and description for this card.” Open the proposed change and review **Changes** or **Result**. The saved card stays unchanged until **Apply** is selected. **Reject** leaves the saved content unchanged.
4. **Questions:** Ask: “Ask me two independent questions with choices about who will use this app and when.” Choose answers or **Write my own answer**, then use **Send answers**. Intermediate selections do not send a message or approve a card change.
5. **Reference materials:** Open **Reference materials** and add a non-sensitive UTF-8 Markdown or source file. Ask AI to read it and cite the file and line numbers. Registration is read-only; the app does not edit source files or run shell commands. Removing a reference stops future access without deleting the original file or past conversation content.
6. **Project memory:** Open **Memory**, save some context, and start another conversation in the same project. The saved memory is available as context. AI-proposed memory changes also require approval.
7. **Export:** Move a card to **Decided**, then select **Export → Choose location and export**. A new folder contains `index.md`, `project.md`, and a `decisions/` folder in OKF v0.2 format. Decision filenames retain their sequence number and title. Saved card and memory text is preserved verbatim; drafts, pending changes, and chat history are excluded.
8. **Persistence and recovery:** Archive a card and restore it from **Archive**. Close and reopen the app to check saved cards and conversations. Re-enter the review code if testing AI again. Unsaved editor/chat drafts are not retained after exiting.

## TestFlight: What to Test draft

Use this text for internal testing after Apple has processed the selected build. It is a test plan, not a record of completed checks.

On September 28, 2026, the developer chose to defer installation and launch through TestFlight rather than sign in with a personal Apple Account on a borrowed Mac. Earlier testing of the separate Sandbox validation app is not confirmation that the Store-distributed build was installed and tested. This status note is internal preparation context, not copy for the What to Test field.

> Test on Apple Silicon with macOS 26 or later. Create a separate test project and confirm manual card creation, editing, and Markdown export. Connect using Continue with ChatGPT or use the privately supplied review access code, create a card through chat, and apply or reject a proposed change. Register a non-sensitive text file and folder, quit with Command-Q, reopen the app, and verify that references can still be listed, read, and searched. Modify a source file and confirm the latest contents can be read. Remove a reference and confirm future access is denied without deleting the source. Check saved cards and conversations after restarting. Report errors with the build number, steps, and error text; do not include private reference contents or credentials.

## Data handling and availability

Cards, project memory, and conversations are stored locally. AI is optional. Review AI requests pass through the developer's relay server to OpenAI after explicit consent. The relay does not normally log conversation bodies or credentials. It retains hashed code/access records and usage counts, and hosting infrastructure may retain operational request logs. OpenAI's own data retention terms still apply; disabling storage in an API request is not a guarantee of zero retention.

Reference materials are read only as needed. The initial scope is UTF-8 text up to 1 MiB per file, with up to 32 registered files/folders per project. Excluded paths include `.git`, `node_modules`, build outputs, `.env`, private keys, and links. PDFs and images are not supported as reference materials.

The developer must keep the relay and valid review credentials available throughout review and any follow-up checks. Credentials and the support contact belong in the private submission fields, not in the downloadable app or this repository.
