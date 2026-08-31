export const TRAINING_QUEUE = 'trainingQueue'

export type TrainingJobKind = 'train' | 'evaluate'

export interface TrainingJobPayload {
  kind: TrainingJobKind
}

/**
 * Vai trò của tiến trình recommendation.
 * - `api`    (mặc định): chỉ phục vụ HTTP, đẩy job vào hàng đợi.
 * - `worker`: chạy các tác vụ nặng CPU (train/evaluate) và cron hằng ngày.
 *
 * Tách vai trò để việc huấn luyện — vòng lặp 100 cây quyết định hoàn toàn
 * đồng bộ — không chiếm event loop của tiến trình đang phục vụ request.
 */
export function isWorkerRole(): boolean {
  return process.env.RECOMMENDATION_ROLE?.trim().toLowerCase() === 'worker'
}
