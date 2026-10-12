export interface ChallengePrompt {
  id: string;
  text: string;
  category: string;
  difficulty: number;
}

export const CHALLENGE_PROMPTS: ChallengePrompt[] = [
  { id: 'daily-01', text: 'I usually review my notes before an important meeting.', category: 'Daily routine', difficulty: 1 },
  { id: 'travel-01', text: 'The train leaves from platform three at half past nine.', category: 'Travel', difficulty: 1 },
  { id: 'food-01', text: 'Could I have a glass of water with my lunch, please?', category: 'Everyday conversation', difficulty: 1 },
  { id: 'work-01', text: 'I will send the updated report before the end of the day.', category: 'Work', difficulty: 2 },
  { id: 'travel-02', text: 'Although the weather was changing, we continued toward the station.', category: 'Travel', difficulty: 2 },
  { id: 'learning-01', text: 'Practicing a little every day helps me speak with more confidence.', category: 'Learning', difficulty: 2 },
  { id: 'work-02', text: 'The team postponed the launch because two important details needed review.', category: 'Work', difficulty: 3 },
  { id: 'technology-01', text: 'A reliable connection makes remote collaboration much easier.', category: 'Technology', difficulty: 3 },
  { id: 'opinion-01', text: 'I prefer a clear explanation over a complicated answer.', category: 'Giving an opinion', difficulty: 3 },
  { id: 'work-03', text: 'If we compare the latest results with last quarter, the improvement is clear.', category: 'Work', difficulty: 4 },
  { id: 'community-01', text: 'The neighborhood project succeeded because residents shared practical ideas.', category: 'Community', difficulty: 4 },
  { id: 'opinion-02', text: 'Even when priorities change, a thoughtful plan can keep a project on track.', category: 'Giving an opinion', difficulty: 4 },
  { id: 'technology-02', text: 'Small design decisions can have a meaningful effect on how people use a product.', category: 'Technology', difficulty: 5 },
  { id: 'learning-02', text: 'When feedback is specific and encouraging, learners are more likely to keep practicing.', category: 'Learning', difficulty: 5 },
  { id: 'work-04', text: 'We should consider both the short-term cost and the long-term benefit before deciding.', category: 'Work', difficulty: 5 },
];

export function difficultyLabel(level: number): string {
  return ['Starter', 'Steady', 'Balanced', 'Advanced', 'Flow'][Math.max(0, Math.min(4, level - 1))] ?? 'Starter';
}
