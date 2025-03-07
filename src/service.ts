
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import ffmpeg from "fluent-ffmpeg";
import fs from 'fs/promises';
import { extname, join } from "path";

import { SYSTEM_PROMPT } from "./prompt";
import type { Sender, ZodSchema } from "./schema";
import { zodSchema } from "./schema";

const IMAGE_QUALITY = '50%';
const FRAMES_PER_SECOND = 2;

const CONTENT_DIR = join(__dirname, '../src', 'content');
const OUTPUT_DIR = join(__dirname, '../src', 'output');

type User = {
  firstName: string;
}

export class ProcessScreenRecordingConsumer {
  private googleGemini: ChatGoogleGenerativeAI;
  private user: User;

  constructor() {
    this.googleGemini = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GOOGLE_API_KEY,
    });

    this.user = {
      firstName: process.env.USER_FIRST_NAME ?? "",
    };
  }

  async consume(fileName: string) {
    console.log(`Processing video ${fileName}`);
    try {
      // Process the video (get base64 frames)
      const base64Frames = await this.processVideo(fileName);

      const llm = this.googleGemini.withStructuredOutput(zodSchema);

      const result = await llm.invoke([
        new SystemMessage(this.getSystemPrompt()),
        new HumanMessage({
          content: [
            {
              type: 'text',
              text: 'Extract the text messages from the provided images, which are screenshots of my chat conversations',
            },
            ...base64Frames.map((frameURL) => ({
              type: 'image_url',
              image_url: frameURL,
            })),
          ],
        }),
      ])


      if (!result.messages.length) {
        console.log(`No messages found in ${fileName}`);
        return;
      }

      await this.storeChatSnippetsAsJSON(result, this.user.firstName);

      console.log(`
        Extracted ${result.messages.length} messages from ${fileName}
        User useds the platform: ${result.platform}
        User is chatting with: ${result.object}
        Check the output directory for the JSON file exported and screenshots extracted
        `)

    } catch (error) {
      console.error("Error processing video:", error);
    }
  }

  private async processVideo(fileName: string): Promise<string[]> {
    const filePath = join(CONTENT_DIR, fileName);
    // Get video duration then extract frames
    const duration = await this.getVideoDuration(filePath);

    // Calculate number of frames based on duration and fps
    const frameCount = Math.floor(duration * FRAMES_PER_SECOND);

    // Extract frames from the video
    const frames = await this.extractFrames(filePath, OUTPUT_DIR, frameCount);

    console.log(`Extracted ${frames.length} frames from ${fileName}`);

    // Convert frames to base64
    const frameData = await Promise.all(
      frames.map(async (frame) => {
        const fullPath = join(OUTPUT_DIR, 'frames', frame);
        const base64 = await this.imageToBase64(fullPath);
        return { filename: frame, base64 };
      })
    );

    return frameData.map((frame) => frame.base64);
  }

  private async getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          return reject(err);
        }

        // Duration is in seconds
        const duration = metadata.format.duration || 0;
        return resolve(duration);
      });
    });
  }

  private async extractFrames(videoPath: string, tempDir: string, frameCount: number) {
    return new Promise<string[]>((resolve, reject) => {
      const frames: string[] = [];
      ffmpeg(videoPath)
        .on("filenames", (filenames) => {
          frames.push(...filenames);
        })
        .on("error", (err) => {
          reject(err);
        })
        .on("end", () => {
          resolve(frames);
        })
        .screenshots({
          count: frameCount,
          folder: `${tempDir}/frames`,
          filename: "screenshot-%i.jpeg",
          size: IMAGE_QUALITY,
        });
    });
  }

  private async imageToBase64(imagePath: string): Promise<string> {
    const imageBuffer = await fs.readFile(imagePath);
    const extension = extname(imagePath).substring(1); // Get extension without dot
    const mimeType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  }

  private getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  private async storeChatSnippetsAsJSON(input: ZodSchema, userFirstName: string) {
    const messages = this.inputMessageDeduplicate(input.messages);

    const jsonData = JSON.stringify({
      subject: userFirstName,
      messages: messages.map(msg => ({
        sender: this.getSenderName(msg.sender, input.object, userFirstName),
        contentType: "text",
        content: msg.content,
        sentAt: new Date(msg.sentAt).getTime(),
      }))
    });

    const tempFileName = `chat-snippets-${new Date().toISOString()}.json`;
    const tempFilePath = join(OUTPUT_DIR, tempFileName);
    await fs.writeFile(tempFilePath, jsonData);
  }

  private getSenderName(senderType: Sender, objectName: string, userFirstName: string): string {
    // There is a chance we cannot get the subjectName from the screenshot, so we use the user's first name
    return senderType === 'subject' ? userFirstName : objectName;
  }

  private inputMessageDeduplicate<T extends { sentAt: string }>(inMsgs: T[]): T[] {
    const deduped: T[] = [];
    const dateOccurrences = new Map<string, number>();

    for (const msg of inMsgs) {
      const originalTime = new Date(msg.sentAt).getTime();
      const key = originalTime.toString();
      const count = dateOccurrences.get(key) || 0;
      const newCount = count + 1;
      dateOccurrences.set(key, newCount);

      // Adjust SentAt by adding (newCount - 1) milliseconds to ensure uniqueness
      msg.sentAt = new Date(originalTime + (newCount - 1)).toISOString();
      deduped.push(msg);
    }
    return deduped;
  }
}