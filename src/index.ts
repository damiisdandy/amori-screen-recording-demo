import { ProcessScreenRecordingConsumer } from "./service";

import dotenv from "dotenv";
dotenv.config();


const consumer = new ProcessScreenRecordingConsumer();

(async () => {
  await consumer.consume('video.MP4');
})();