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
