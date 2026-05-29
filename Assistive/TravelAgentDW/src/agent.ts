import { configDotenv } from 'dotenv';
configDotenv();

import { TurnState, AgentApplication, TurnContext, MemoryStorage } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import '@microsoft/agents-a365-notifications';
import {
  AgentNotificationActivity,
  NotificationType,
  createEmailResponseActivity,
} from '@microsoft/agents-a365-notifications';
import { Client, getClient } from './client.js';
// A365 Observability — best-effort instrumentation (verify against official sample)
// A365 auth mode: agentic-user
import {
  AgenticTokenCacheInstance,
  BaggageBuilder,
  BaggageBuilderUtils,
  InvokeAgentScope,
} from '@microsoft/opentelemetry';
import type { AgentDetails, CallerDetails, UserDetails, InvokeAgentScopeDetails, A365Request, ServiceEndpoint, Channel } from '@microsoft/opentelemetry';

// A365 WorkIQ — best-effort wiring (verify against SDK source before production)
const userKeyToConversationId = new Map<string, string>();

function userKeysFor(from: any): string[] {
  if (!from) return [];
  const keys = new Set<string>();
  if (from.aadObjectId) keys.add(`aad:${String(from.aadObjectId).toLowerCase()}`);
  if (from.id)          keys.add(`id:${String(from.id).toLowerCase()}`);
  if (from.name)        keys.add(`name:${String(from.name).toLowerCase()}`);
  return [...keys];
}

export class TravelTeammateAgent extends AgentApplication<TurnState> {
  static authHandlerName = 'agentic';

  // Varied acknowledgments — picked at random each turn so follow-ups don't feel robotic.
  static ACKS = [
    '✈️ On it — let me find the best options for you…',
    'Looking into that now — give me a moment…',
    'On it! Pulling together some options for you…',
  ];

  constructor() {
    super({
      storage: new MemoryStorage(),
      proactive: {},  // required for proactive Teams DMs (Word @mention replies)
      authorization: {
        agentic: { type: 'agentic' },
      },
    });

    // Notifications — priority 1, restricted to agentic auth
    this.onAgentNotification(
      'agents:*',
      async (context, state, notification: AgentNotificationActivity) => {
        await this.handleAgentNotificationActivity(context, state, notification);
      },
      1,
      [TravelTeammateAgent.authHandlerName]
    );

    // Messages — restricted to agentic auth
    this.onActivity(
      ActivityTypes.Message,
      async (context, state) => {
        await this.handleAgentMessageActivity(context, state);
      },
      [TravelTeammateAgent.authHandlerName]
    );

    // Lifecycle — install / uninstall (no auth restriction)
    this.onActivity(ActivityTypes.InstallationUpdate, async (context, state) => {
      await this.handleInstallationUpdateActivity(context, state);
    });
  }

  async handleAgentMessageActivity(turnContext: TurnContext, state: TurnState): Promise<void> {
    console.log(`[MSG HANDLER] Entered handleAgentMessageActivity, text="${turnContext.activity.text?.slice(0, 60)}"`);
    const userMessage = turnContext.activity.text?.trim() || '';
    const from = turnContext.activity?.from;
    const displayName = from?.name ?? 'unknown';

    // Log activity details for debugging @mention handling
    const activity = turnContext.activity as any;
    if (activity.entities?.length || activity.attachments?.length) {
      console.log('[Activity] entities:', JSON.stringify(activity.entities?.map((e: any) => e.type)));
      console.log('[Activity] attachments:', JSON.stringify(activity.attachments?.map((a: any) => ({ name: a.name, contentType: a.contentType, contentUrl: a.contentUrl?.substring(0, 80) }))));
    }

    // Detect Word @mention: check entities for mention type (SDK strips <at> tags from text)
    const entities = (turnContext.activity as any).entities ?? [];
    const isWordMention = entities.some((e: any) => e.type === 'mention') || /<at>.*<\/at>/i.test(userMessage);
    if (isWordMention) {
      console.log('[Word @mention] Detected Word @mention message');
    }

    // Track the conversation for proactive DMs — ONLY for genuine 1:1 / personal turns.
    // A Word @mention arrives on the wpx/agents channel, which is NOT a DM-able
    // conversation; tracking it would overwrite the user's real 1:1 reference and
    // break the proactive notification we send after replying to the comment.
    if (!isWordMention) {
      await this.trackConversationForProactive(turnContext);
    }

    if (!userMessage) {
      await turnContext.sendActivity("Please send me a message and I'll help you!");
      return;
    }

    // A365 Observability — best-effort instrumentation (verify against official sample)
    // A365 auth mode: agentic-user
    await this.preloadObservabilityToken(turnContext);

    const baggageScope = BaggageBuilderUtils
      .fromTurnContext(new BaggageBuilder(), turnContext as any)
      .sessionDescription('travel-agent-turn')
      .build();

    await baggageScope.run(async () => {
      // A365 Observability — start the InvokeAgentScope FIRST (before any send) and
      // publish its span context to turnState. The OutputLoggingMiddleware (enabled in
      // index.ts via configureA365Hosting) reads turnState['A365ParentSpanId'] on each
      // outbound message; setting it here links the ack + final response to this
      // agent-invocation span instead of logging
      // "No parent span ref in turnState under 'A365ParentSpanId'".
      const agentDetails: AgentDetails = {
        agentId: turnContext.activity?.recipient?.agenticAppId ?? process.env.agent365Observability__agentId ?? '',
        agentName: process.env.agent365Observability__agentName ?? 'TravelTeammate',
        agentDescription: process.env.agent365Observability__agentDescription ?? '',
        tenantId: turnContext.activity?.recipient?.tenantId ?? process.env.agent365Observability__tenantId ?? '',
      };
      const callerDetails: CallerDetails = {
        userDetails: {
          userId: from?.aadObjectId ?? from?.id ?? '',
          userName: displayName,
        } as UserDetails,
      };
      const request: A365Request = {
        content: userMessage,
        sessionId: turnContext.activity?.conversation?.id ?? '',
        conversationId: turnContext.activity?.conversation?.id ?? '',
        channel: { name: 'msteams' } as Channel,
      };
      const scopeDetails: InvokeAgentScopeDetails = {
        endpoint: { host: 'localhost', port: 3978 } as ServiceEndpoint,
      };

      let scope: InvokeAgentScope | null = null;
      try {
        scope = InvokeAgentScope.start(request, scopeDetails, agentDetails, callerDetails);
        // Publish the parent span ref so OutputLoggingMiddleware can link outbound
        // OutputScope spans to this invocation (SpanContext is a valid ParentSpanRef).
        (turnContext.turnState as any).set('A365ParentSpanId', scope.getSpanContext());
      } catch (scopeErr) {
        console.error('[Scope] Failed to start scope:', scopeErr);
      }

      // For Word @mentions, sendActivity may fail (different reply URL format)
      try {
        const ack = TravelTeammateAgent.ACKS[Math.floor(Math.random() * TravelTeammateAgent.ACKS.length)];
        await turnContext.sendActivity(ack);
        await turnContext.sendActivity({ type: 'typing' } as Activity);
      } catch (typingErr) {
        console.warn('[Flow] Initial sendActivity failed (expected for Word @mentions):', (typingErr as any)?.message?.slice(0, 100));
      }

      let typingInterval: ReturnType<typeof setInterval> | undefined;
      const startTypingLoop = () => {
        typingInterval = setInterval(() => {
          turnContext.sendActivity({ type: 'typing' } as Activity).catch(() => {});
        }, 4000);
      };
      const stopTypingLoop = () => clearInterval(typingInterval);

      startTypingLoop();

      try {
        const doWork = async () => {
          if (scope) scope.recordInputMessages([userMessage]);

          const client: Client = await getClient(
            this.authorization,
            TravelTeammateAgent.authHandlerName,
            turnContext,
            displayName
          );
          console.log('[Flow] Client created, preparing prompt...');

          // For Word @mentions, augment the prompt to use Word tools
          let effectiveMessage = userMessage;
          let documentName = 'the document';
          if (isWordMention) {
            const attachments = (turnContext.activity as any)?.attachments ?? [];
            const fileAttachment = attachments.find((a: any) =>
              typeof a?.contentUrl === 'string' && /\.(docx?|doc)(\?|$)/i.test(a.contentUrl),
            ) ?? attachments[0];
            const documentUrl = fileAttachment?.contentUrl ?? '';
            documentName = fileAttachment?.name ?? 'the document';
            const cleanText = userMessage.replace(/<at>.*?<\/at>/gi, '').trim();
            const senderName = from?.name ?? 'a user';

            // Comment/document IDs from the WpxComment notification (wire fields:
            // commentId, parentCommentId, documentId). Passed as context so the model
            // replies to the right comment without searching for it.
            const wpx = entities.find((e: any) => /wpxcomment/i.test(e?.type ?? '')) ?? {};
            const documentId = wpx.documentId ?? '';
            const commentId = wpx.commentId ?? wpx.parentCommentId ?? '';
            const idBlock =
              (documentId ? `documentId: ${documentId}\n` : '') +
              (commentId ? `commentId (reply to THIS comment): ${commentId}\n` : '');

            effectiveMessage =
              `A user (${senderName}) @mentioned you on a comment in the Word document "${documentName}".\n` +
              `Their comment: "${cleanText}"\n` +
              (documentUrl ? `Document URL: ${documentUrl}\n` : '') +
              idBlock + `\n` +
              `Do exactly this, using the FEWEST possible tool calls:\n` +
              `1. Read the document ONCE via mcp_WordServer.GetDocumentContent (use the Document URL) — do NOT call it more than once.\n` +
              `2. Reply to THAT comment with the Word REPLY tool (its name contains "reply"), using commentId above — never AddComment, never start a new thread.\n` +
              `3. Keep the reply concise and directly useful. Do not call any other tools.\n` +
              `End your final message with exactly: "Replied to the comment with: <the reply text you posted>".`;
            console.log('[Word @mention] Augmented prompt for Word tools');
          }

          console.log('[Flow] Invoking LLM...');
          const response = await client.invoke(effectiveMessage);
          console.log(`[Response] Got response (${response?.length ?? 0} chars), sending to user...`);
          if (scope) scope.recordOutputMessages([response]);
          console.log('[Flow] Sending activity...');
          try {
            await turnContext.sendActivity(response);
            console.log('[Response] Sent successfully');
          } catch (sendErr) {
            console.warn('[Response] sendActivity failed (expected for Word @mentions — response was delivered via MCP tools):', (sendErr as any)?.message?.slice(0, 100));
          }

          // Word @mention: the reply was posted on the comment via the MCP Word tool,
          // but the user isn't watching the document — proactively DM them in Teams
          // with the reply text. Uses the 1:1 conversation tracked from a prior direct
          // message (looked up by any of the user's identifiers — aad / id / name).
          if (isWordMention) {
            try {
              const convId = userKeysFor(from)
                .map((k) => userKeyToConversationId.get(k))
                .find(Boolean);
              if (convId) {
                const replyText = response?.match(/Replied to the comment with:\s*([\s\S]+)/i)?.[1]?.trim() || response;
                await (this as any).proactive.sendActivity((this as any).adapter, convId, {
                  text: `I replied to your comment on **${documentName}**:\n\n${replyText?.substring(0, 1500)}`,
                });
                console.log('[Word @mention] Proactive DM sent to user');
              } else {
                console.warn('[Word @mention] No tracked 1:1 conversation — cannot DM. Ask the user to message me directly once to enable Word notifications.');
              }
            } catch (dmErr) {
              console.warn('[Word @mention] Proactive DM failed:', (dmErr as any)?.message?.slice(0, 120));
            }
          }
        };

        if (scope) {
          await scope.withActiveSpanAsync(async () => {
            try {
              await doWork();
            } catch (error) {
              console.error('[Flow] Error inside scope span:', error);
              const err = error as any;
              if (scope) scope.recordError(error as Error);
              await turnContext.sendActivity(`Error: ${err.message || err}`);
            } finally {
              stopTypingLoop();
            }
          });
        } else {
          // No scope — run without observability
          try {
            await doWork();
          } catch (error) {
            console.error('[Flow] Error (no scope):', error);
            const err = error as any;
            await turnContext.sendActivity(`Error: ${err.message || err}`);
          } finally {
            stopTypingLoop();
          }
        }
      } catch (outerErr) {
        console.error('[Flow] OUTER error (scope wrapper failed):', outerErr);
        stopTypingLoop();
      } finally {
        if (scope) scope.dispose();
      }
    });
  }

  // A365 Observability — best-effort instrumentation (verify against official sample)
  private async preloadObservabilityToken(turnContext: TurnContext): Promise<void> {
    try {
      const agentId = turnContext.activity?.recipient?.agenticAppId ?? '';
      const tenantId = turnContext.activity?.recipient?.tenantId ?? '';
      await AgenticTokenCacheInstance.refreshObservabilityToken(
        agentId,
        tenantId,
        turnContext as any,
        this.authorization as any,
      );
    } catch {
      // Token preload failed — observability may be degraded but agent continues
    }
  }

  async handleAgentNotificationActivity(
    context: TurnContext,
    state: TurnState,
    notification: AgentNotificationActivity
  ): Promise<void> {
    const text = context.activity.text ?? '';
    const entities = (context.activity as any).entities ?? [];
    const hasMentionEntity = entities.some((e: any) => e.type === 'mention');
    const fromName = context.activity.from?.name ?? '';
    console.log(`[NOTIF HANDLER] Entered, type=${notification.notificationType}, from="${fromName}", text="${text.slice(0, 60)}", entities=${JSON.stringify(entities.map((e: any) => e.type))}, hasMention=${hasMentionEntity}`);

    // @mention messages arrive on the agents channel and are intercepted by this handler.
    // Detect via mention entity OR non-system sender (not SharePoint/email notifications).
    // The SDK strips <at> tags from activity.text, so check entities instead.
    if (hasMentionEntity || (/<at>.*<\/at>/i.test(text))) {
      console.log('[NOTIF HANDLER] Detected @mention — forwarding to message handler');
      await this.handleAgentMessageActivity(context, state);
      return;
    }

    switch (notification.notificationType) {
      case NotificationType.EmailNotification:
        await this.handleEmailNotification(context, state, notification);
        break;
      // A365 WorkIQ — best-effort wiring (verify against SDK source before production)
      case NotificationType.WpxComment:
        await this.handleWpxCommentNotification(context, state, notification);
        break;
      default:
        await context.sendActivity(
          `Received notification of type: ${notification.notificationType}`
        );
    }
  }

  private async handleEmailNotification(
    context: TurnContext,
    state: TurnState,
    activity: AgentNotificationActivity
  ): Promise<void> {
    const emailNotification = activity.emailNotification;
    if (!emailNotification) {
      await context.sendActivity(
        createEmailResponseActivity('I could not find the email notification details.')
      );
      return;
    }
    try {
      const client: Client = await getClient(
        this.authorization,
        TravelTeammateAgent.authHandlerName,
        context
      );
      const emailContent = await client.invoke(
        `You have a new email from ${context.activity.from?.name} ` +
        `with id '${emailNotification.id}', ` +
        `ConversationId '${emailNotification.conversationId}'. ` +
        `Please retrieve this message and return it in text format.`
      );
      const response = await client.invoke(
        `You have received the following email. Please follow any instructions in it. ${emailContent}`
      );
      await context.sendActivity(
        createEmailResponseActivity(
          response || 'I have processed your email but do not have a response at this time.'
        )
      );
    } catch (error) {
      console.error('Email notification error:', error);
      await context.sendActivity(
        createEmailResponseActivity('Unable to process your email at this time.')
      );
    }
  }

  // A365 WorkIQ — best-effort wiring (verify against SDK source before production)
  private async handleWpxCommentNotification(
    context: TurnContext,
    state: TurnState,
    activity: AgentNotificationActivity
  ): Promise<void> {
    const wpx = (activity as any).wpxCommentNotification;
    if (!wpx) return;

    // URL is not on wpxCommentNotification — pull from raw attachments
    const attachments = (context.activity as any)?.attachments ?? [];
    const fileAttachment = attachments.find((a: any) =>
      typeof a?.contentUrl === 'string' && /\.(docx?|doc)(\?|$)/i.test(a.contentUrl),
    ) ?? attachments[0];
    const documentUrl = fileAttachment?.contentUrl;
    const documentName = fileAttachment?.name ?? 'the document';
    const commentText = (context.activity as any)?.text ?? '';
    const senderName = context.activity.from?.name ?? 'a user';

    const client = await getClient(
      this.authorization,
      TravelTeammateAgent.authHandlerName,
      context
    );

    // Tell the LLM to use the REPLY tool — default behaviour is AddComment (new thread)
    const prompt =
      `${senderName} @mentioned you on a comment in "${documentName}".\n` +
      `Comment: ${commentText}\nDocument URL: ${documentUrl}\n` +
      `Steps:\n` +
      `1. Call mcp_WordServer.GetDocumentContent with the URL.\n` +
      `2. Find the comment matching the text above; capture driveId, documentId, commentId.\n` +
      `3. Use the Word REPLY tool (name contains "reply") — NOT AddComment.\n` +
      `4. Reply concisely. Finish with: "Replied to commentId=<id> with: <text>".`;

    const response = await client.invoke(prompt);

    // Proactively notify the user in Teams (needs prior tracked conversation)
    const convId = userKeysFor(context.activity.from)
      .map(k => userKeyToConversationId.get(k))
      .find(Boolean);
    if (convId) {
      const replyText = response?.match(/Replied to commentId=\S+ with:\s*([\s\S]+)/)?.[1] ?? response;
      await (this as any).proactive.sendActivity((this as any).adapter, convId, {
        text: `I replied to your comment on **${documentName}**:\n\n${replyText?.substring(0, 1500)}`,
      });
    }
  }

  // A365 WorkIQ — best-effort wiring (verify against SDK source before production)
  private async trackConversationForProactive(context: TurnContext): Promise<void> {
    try {
      const convId = await (this as any).proactive.storeConversation(context);
      for (const k of userKeysFor(context.activity.from)) {
        userKeyToConversationId.set(k, convId);
      }
    } catch {
      // Proactive tracking failed — Word @mention DMs will be unavailable
    }
  }

  async handleInstallationUpdateActivity(
    context: TurnContext,
    _state: TurnState
  ): Promise<void> {
    if (context.activity.action === 'add') {
      await this.trackConversationForProactive(context);
      await context.sendActivity(
        'Thank you for hiring me! I\'m your travel assistant — give me a destination and dates, and I\'ll find flights, hotels, and restaurants for you!'
      );

      // MCP warm-up — connecting to the Word/OneDrive MCP servers costs ~6–10s and
      // is normally paid on the user's FIRST message. We have a turn context + auth
      // here at install time, so pre-build and cache the user's MCP agent now; their
      // first real message then lands as a cache hit. Best-effort — if it fails the
      // first message simply connects as before.
      try {
        const displayName = context.activity.from?.name ?? 'unknown';
        const warmStart = Date.now();
        await getClient(this.authorization, TravelTeammateAgent.authHandlerName, context, displayName);
        console.log(`[MCP] Warm-up on install complete in ${Date.now() - warmStart}ms — first message will hit cache`);
      } catch (warmErr) {
        console.warn('[MCP] Warm-up on install failed (first message will connect normally):', (warmErr as any)?.message?.slice(0, 120));
      }
    } else if (context.activity.action === 'remove') {
      await context.sendActivity('Thank you for your time, I enjoyed helping you plan trips!');
    }
  }
}

export const agentApplication = new TravelTeammateAgent();
