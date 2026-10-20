import type { CefrLevel } from "./feedback";

/**
 * A ready-made class so a new teacher can try the whole loop (draft, review,
 * release) in two minutes, before involving real students. The essays are
 * invented and contain typical errors for each level.
 */
export const SAMPLE_ASSIGNMENT: { title: string; task: string; cefr_level: CefrLevel } = {
  title: "Sample: City or countryside?",
  task: "Some people prefer to live in a big city, others in the countryside. Which do you prefer and why? Give reasons and examples from your own life. Write 120–180 words.",
  cefr_level: "B1",
};

export const SAMPLE_ESSAYS: { student_name: string; body: string }[] = [
  {
    student_name: "Sample student: Leo (weaker)",
    body: `I prefer live in the city. In the city there is many things to do. I can go to cinema, shopping mall and restaurant with my friends every weekend.

In countryside is very quiet and boring. My grandmother live in a village and when i visit her there is nothing to do, only watch TV. Also the internet is very slow.

But the city have some problems. The air is dirty and there is too much cars. Sometimes I cannot sleep because the noise.

In conclusion I think city is more better for young people because we have more chance for study and work.`,
  },
  {
    student_name: "Sample student: Mia (average)",
    body: `Although many people dream about a quiet life in the countryside, I would rather live in a big city, mainly because of the opportunities it offers.

Firstly, cities have better schools and universities. For example, my cousin moved to the capital last year and now she can study design, which is impossible in our small town. Moreover, there are more jobs, so it is easier to find a good career after you finish your studies.

Secondly, city life is never boring. There are museums, concerts and sport clubs, and you can meet people from many different countries.

On the other hand, I must admit that cities are expensive and stressful. Rents are very high and people are always in a hurry. However, I think these problems are worth it when you are young.

To sum up, the countryside is a nice place to relax for a weekend, but for living I prefer the city.`,
  },
  {
    student_name: "Sample student: Sam (stronger)",
    body: `Having grown up in a fishing village and then spent three years in a large city, I have experienced both lifestyles, and on balance I would choose the countryside.

The most obvious advantage is the pace of life. In the city, I spent almost two hours a day commuting on crowded trains, which left me exhausted and with little time for hobbies. In my village, by contrast, everything is within walking distance, so my days feel longer and calmer.

Another factor is community. Neighbours in the countryside tend to know and support each other; when my father was ill, people we barely knew brought us meals for weeks. I rarely saw that kind of solidarity in my apartment building, where I didn't even know the names of the people next door.

Admittedly, rural areas lack some services, and young people often have to leave to find work. Nevertheless, with remote working becoming more common, this disadvantage is shrinking, and I believe the quality of life in the countryside will only become more attractive.`,
  },
];
