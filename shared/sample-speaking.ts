import type { CefrLevel } from "./feedback";
import { speechMeasures, syntheticTimings, type SpeechData } from "./speech";

/**
 * A sample speaking class. There are no recordings: the transcripts are
 * invented and the word timings are generated, so a teacher can try reviewing
 * spoken answers before asking students to record. "/" marks a long pause.
 */
export const SAMPLE_SPEAKING_ASSIGNMENT: { title: string; task: string; cefr_level: CefrLevel } = {
  title: "Sample (speaking): A place you love",
  task: "Talk for about one minute. Describe a place you love to visit. Say where it is, what you do there, and why it is special to you.",
  cefr_level: "B1",
};

const SCRIPTS: { student_name: string; script: string; wpm: number }[] = [
  {
    student_name: "Sample speaker: Leo (weaker)",
    wpm: 78,
    script:
      "Um, the place I love is, um, the beach / near my city. I go there with my family in the summer. / We, er, we swim and we eat the fish, very delicious fish. / It is special because, um / because I am happy there, and my father is not work, he is relax. / Um, that's all.",
  },
  {
    student_name: "Sample speaker: Mia (average)",
    wpm: 112,
    script:
      "The place I love most is my grandmother's village in the mountains. It's about three hours from my city by bus. When I'm there, I usually walk in the forest, help my grandmother in her garden, and, um, in the evening we cook together. / It's special to me because it's very quiet, and I can forget about school and my phone. Also, I have a lot of memories there from when I was a child, so it feels like a second home.",
  },
  {
    student_name: "Sample speaker: Sam (stronger)",
    wpm: 138,
    script:
      "I'd have to say the old harbour in my hometown. It's not a famous place at all, but there's a little café right on the water where I've been going since I was about twelve. I usually go there on Sunday mornings, order a coffee, and just watch the fishing boats come back in. What makes it special is, well, it's the one place where time seems to slow down. Whenever I'm stressed about exams, sitting there for an hour completely resets my mind, and honestly I think everyone needs a place like that.",
  },
];

export function sampleSpeakingSubmissions(): { student_name: string; text: string; speech: SpeechData }[] {
  return SCRIPTS.map(({ student_name, script, wpm }) => {
    const { text, words } = syntheticTimings(script, wpm);
    const duration = (words.at(-1)?.e ?? 0) + 0.8;
    return { student_name, text, speech: { words, unsure: [], measures: speechMeasures(words, duration) } };
  });
}
