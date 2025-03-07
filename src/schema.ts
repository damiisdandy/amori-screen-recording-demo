import { z } from 'zod';

const senderSchema = z.enum(['subject', 'object'])

export const zodSchema = z.object({
  object: z.string().describe('Name of the person being texted, typically displayed at the top of the conversation'),
  platform: z.string().describe('The messaging platform used (WhatsApp, Instagram, iMessage, etc.)'),
  messages: z.array(z.object({
    sender: senderSchema.describe('"subject" is the person viewing/taking the screenshot, "object" is the person they\'re texting'),
    content: z.string().describe('The exact text content of the message including emojis and formatting'),
    sentAt: z.string().datetime().describe('The timestamp of the message'),
  })).describe('Chronological sequence of messages in the conversation'),
})

export type ZodSchema = z.infer<typeof zodSchema>; export type Sender = z.infer<typeof senderSchema>;
