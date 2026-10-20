/** Starter rubric so a new teacher can run a first assignment in two minutes. */
export const EFL_WRITING_TEMPLATE = {
  title: "EFL writing (4 criteria, 0–5)",
  criteria: [
    {
      name: "Task response",
      description: "Answers every part of the task, with a clear position and relevant, developed ideas.",
      descriptors: [
        "No real attempt at the task, or off topic.",
        "Barely addresses the task; ideas are very limited or mostly irrelevant.",
        "Addresses part of the task; ideas are few, unclear or not developed.",
        "Addresses all parts of the task, but some ideas need more support or examples.",
        "Addresses all parts well; ideas are relevant and supported with examples.",
        "Fully answers the task with a clear position throughout and well-developed, convincing ideas.",
      ],
    },
    {
      name: "Organisation",
      description: "Paragraphing, logical order, and linking words that guide the reader.",
      descriptors: [
        "No recognisable organisation.",
        "Ideas are listed with almost no order or linking.",
        "Some order, but paragraphing is missing or confusing; linking is basic or repetitive.",
        "Clear overall order and paragraphs; linking words are used but sometimes mechanically or wrongly.",
        "Logical paragraphs, each with a clear focus; a good range of linking used mostly accurately.",
        "Effortless to follow; paragraphing and linking are natural and varied.",
      ],
    },
    {
      name: "Vocabulary",
      description: "Range and accuracy of words, collocations and spelling.",
      descriptors: [
        "Too few words to judge.",
        "Very limited vocabulary; frequent errors make the text hard to understand.",
        "Basic vocabulary, often repeated; errors sometimes affect meaning.",
        "Adequate range for the task; some less common words; errors rarely affect meaning.",
        "Good range including some precise and less common words; occasional slips.",
        "Wide, precise and natural vocabulary; errors are rare and minor.",
      ],
    },
    {
      name: "Grammar",
      description: "Range and accuracy of sentence structures, tenses and agreement.",
      descriptors: [
        "Too little language to judge.",
        "Only memorised phrases; errors dominate.",
        "Mostly simple sentences; frequent errors, some of which affect meaning.",
        "A mix of simple and complex sentences; errors are noticeable but meaning is clear.",
        "A variety of complex structures; most sentences are error-free.",
        "Wide range of structures used flexibly and accurately; rare minor slips.",
      ],
    },
  ],
};

/**
 * Starter speaking rubric. Pronunciation is deliberately not a scored criterion:
 * scoring it from a transcript is unreliable, so the teacher judges it by
 * listening, helped by the stretches the recogniser was unsure about.
 */
export const EFL_SPEAKING_TEMPLATE = {
  title: "EFL speaking (4 criteria, 0–5)",
  criteria: [
    {
      name: "Fluency and coherence",
      description: "Speaks at length without unnatural hesitation; ideas are linked and easy to follow.",
      descriptors: [
        "Too little speech to judge.",
        "Long pauses before most words; very little connected speech.",
        "Frequent pauses and repetition; ideas are short and loosely connected.",
        "Keeps going, with some hesitation and repetition; uses simple linking words.",
        "Speaks at length with only occasional hesitation; links ideas with a range of connectors.",
        "Speaks smoothly and naturally; hesitation is for ideas, not words; well-organised answer.",
      ],
    },
    {
      name: "Vocabulary",
      description: "Range and accuracy of words and phrases for the topic.",
      descriptors: [
        "Too few words to judge.",
        "Only isolated words or memorised phrases.",
        "Basic vocabulary, often repeated; gaps make some ideas hard to express.",
        "Enough vocabulary to discuss the topic; some less common words; occasional wrong word choice.",
        "Flexible vocabulary including less common words and some natural phrases; paraphrases well.",
        "Wide, precise and natural vocabulary, including idiomatic language used appropriately.",
      ],
    },
    {
      name: "Grammar",
      description: "Range and accuracy of spoken sentence structures and tenses.",
      descriptors: [
        "Too little language to judge.",
        "Memorised phrases only; errors dominate.",
        "Mostly short simple sentences; frequent errors, some of which affect meaning.",
        "A mix of simple and complex sentences; errors are noticeable but meaning is clear.",
        "A range of complex structures; many sentences are error-free.",
        "Wide range of structures used naturally and accurately; rare minor slips.",
      ],
    },
    {
      name: "Task response",
      description: "Answers the question fully, with relevant ideas, reasons and examples.",
      descriptors: [
        "No real attempt at the task, or off topic.",
        "Barely addresses the question.",
        "Answers part of the question; ideas are few or undeveloped.",
        "Answers the question with some reasons or examples.",
        "Answers fully with relevant, developed reasons and examples.",
        "A full, well-developed answer that is convincing and engaging throughout.",
      ],
    },
  ],
};
