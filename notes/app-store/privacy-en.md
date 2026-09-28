# Tanzakoo Privacy Policy

> Pre-publication draft, September 28, 2026. Resolve the open items and retention practices in [the assessment](privacy-assessment.md), remove this note, and set the effective date when publishing.

This policy explains how the developer of Tanzakoo handles information in the app and its review connection. Contact: **huruikagi@gmail.com**.

## Information on your Mac

Projects, cards, project memory, conversations, and reference registrations are saved in the app's data area on your Mac. You can edit the board and export Markdown without using AI. These manual operations do not send board contents to the developer's server.

Registered files and folders are read-only. Removing a registration does not delete the original files. Exported Markdown and device backups are separate copies that you control.

## When you use AI

After you consent and send a conversation, the information sent includes your message, conversation context, current board cards, project memory, pending proposals, registered file and folder paths, and reference excerpts or tool results needed for the conversation. Paths may contain your local account name.

Regular access sends information to OpenAI through Codex using your ChatGPT account. Authentication information is handled in a dedicated area on your device. OpenAI's retention, use, deletion, and data settings depend on your account and the applicable service terms.

Review access sends the same information through the developer's relay hosted on Railway to the OpenAI API. The relay does not store conversation bodies in its database. To validate access, manage limits, and prevent misuse, it stores a hash of the access code, a grant identifier, expiry and revocation status, request counts, token usage, and related access-control records. The review code and consent held in the running app are lost when you quit.

Infrastructure providers may process operational information such as IP addresses, timestamps, request paths, results, user-agent information, and response times. The relay disables API response storage, but this does not eliminate retention such as OpenAI's abuse-monitoring records.

## Purposes and providers

Information is used to provide AI responses and board operations, authenticate access, manage limits, investigate errors and misuse, and respond to support requests. The developer does not sell this information for advertising. Information processed by external providers, including OpenAI, Railway, and email services, is also subject to their terms and may be processed outside your country or region.

## Retention, withdrawing consent, and deletion

Local data remains until you delete it. Archiving a card is not deletion. Follow the confirmation shown in the app when deleting a project. Removing a reference or withdrawing AI consent does not erase past conversations, information already sent, or exported files.

You can withdraw regular AI consent in Settings. Select Return to regular connection to end review access and withdraw its consent. Manual board features remain available without sending further AI requests.

The developer's intended practice is to retain review access records while needed for review, misuse investigations, and support, then manually delete records no longer needed. Expiring or revoking a code does not automatically delete its records. Infrastructure logs and OpenAI data are subject to the respective providers' retention rules. The app cannot instantly erase all copies of previously transmitted information.

Support emails and attachments are kept for responding and necessary record keeping. Contact us to request access to or deletion of information held by the developer. We may ask for information needed to verify your request and identify the records. The developer cannot remotely inspect or delete information that exists only on your Mac.

## Contact and updates

Email **huruikagi@gmail.com**. Do not send access codes, API keys, passwords, or confidential reference materials. We will update this page when practices change and provide in-app notices or request consent when needed.

References: [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [Railway logs](https://docs.railway.com/observability/logs). API documentation does not establish retention terms for regular ChatGPT access.
