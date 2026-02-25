/**
 * Per-group concurrency control for container execution.
 */

/**
 * Manages per-group locks to prevent concurrent container execution.
 * Ensures only one container runs per group at a time, whether triggered by
 * user messages, scheduled tasks, or IPC commands.
 *
 * Memory is automatically cleaned up when a group's queue becomes empty.
 */
export class GroupLockManager {
  private locks: Map<string, Promise<void>> = new Map();
  private activeCount: Map<string, number> = new Map();

  /**
   * Acquire a lock for the given group and execute the task.
   * Tasks are queued and executed serially per group.
   */
  async withLock<T>(groupFolder: string, task: () => Promise<T>): Promise<T> {
    // Increment active count
    const currentCount = this.activeCount.get(groupFolder) || 0;
    this.activeCount.set(groupFolder, currentCount + 1);

    // Chain this task to the group's queue
    const currentLock = this.locks.get(groupFolder) || Promise.resolve();

    let taskResolve: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      taskResolve = resolve;
    });

    // Update the lock to include this task
    this.locks.set(
      groupFolder,
      currentLock.then(() => taskPromise),
    );

    // Wait for our turn
    await currentLock;

    try {
      return await task();
    } finally {
      // Decrement active count and cleanup if empty
      const newCount = (this.activeCount.get(groupFolder) || 1) - 1;
      if (newCount <= 0) {
        this.activeCount.delete(groupFolder);
        this.locks.delete(groupFolder);
      } else {
        this.activeCount.set(groupFolder, newCount);
      }
      // Signal next task can proceed
      taskResolve!();
    }
  }

  /** Check if a group currently has pending tasks */
  hasPending(groupFolder: string): boolean {
    return (this.activeCount.get(groupFolder) || 0) > 0;
  }
}

// Singleton instance for the application
export const groupLockManager = new GroupLockManager();
