export interface ParsedSchedule {
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  description: string;
}

export function parseNaturalSchedule(text: string): ParsedSchedule | null {
  const normalized = text.trim().toLowerCase();

  // Chinese patterns: 每天早上/下午/晚上 N點
  const dailyChineseMatch = normalized.match(/每天(早上|上午|下午|晚上)(\d{1,2})點/);
  if (dailyChineseMatch) {
    const period = dailyChineseMatch[1];
    let hour = parseInt(dailyChineseMatch[2], 10);

    if ((period === '下午' || period === '晚上') && hour !== 12) {
      hour += 12;
    }
    if ((period === '早上' || period === '上午') && hour === 12) {
      hour = 0;
    }

    return {
      schedule_type: 'cron',
      schedule_value: `0 ${hour} * * *`,
      description: `每天${dailyChineseMatch[1]} ${hour % 12 || 12}:00`
    };
  }

  // English patterns: every day at Xam/Xpm
  const dailyEnglishMatch = normalized.match(/every\s+day\s+at\s+(\d{1,2})(am|pm)/);
  if (dailyEnglishMatch) {
    let hour = parseInt(dailyEnglishMatch[1], 10);
    const period = dailyEnglishMatch[2];

    if (period === 'pm' && hour !== 12) {
      hour += 12;
    }
    if (period === 'am' && hour === 12) {
      hour = 0;
    }

    return {
      schedule_type: 'cron',
      schedule_value: `0 ${hour} * * *`,
      description: `Every day at ${dailyEnglishMatch[1]}${period.toUpperCase()}`
    };
  }

  // Chinese: 每小時
  if (normalized === '每小時') {
    return {
      schedule_type: 'interval',
      schedule_value: '3600000',
      description: '每小時'
    };
  }

  // English: every hour
  if (normalized === 'every hour') {
    return {
      schedule_type: 'interval',
      schedule_value: '3600000',
      description: 'Every hour'
    };
  }

  // Chinese: 每N小時 / 每N分鐘
  const intervalChineseMatch = normalized.match(/每(\d+)(小時|分鐘)/);
  if (intervalChineseMatch) {
    const num = parseInt(intervalChineseMatch[1], 10);
    const unit = intervalChineseMatch[2];
    const ms = unit === '小時' ? num * 3600000 : num * 60000;

    return {
      schedule_type: 'interval',
      schedule_value: String(ms),
      description: `每 ${num} ${unit}`
    };
  }

  // English: every N hours / every N minutes
  const intervalEnglishMatch = normalized.match(/every\s+(\d+)\s+(hour|minute)s?/);
  if (intervalEnglishMatch) {
    const num = parseInt(intervalEnglishMatch[1], 10);
    const unit = intervalEnglishMatch[2];
    const ms = unit === 'hour' ? num * 3600000 : num * 60000;

    return {
      schedule_type: 'interval',
      schedule_value: String(ms),
      description: `Every ${num} ${unit}${num > 1 ? 's' : ''}`
    };
  }

  // Chinese: 每週X (with optional time)
  const weekdayChineseMap: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0
  };

  const weeklyChineseMatch = normalized.match(/每週([一二三四五六日])(早上|上午|下午|晚上)?(\d{1,2})?點?/);
  if (weeklyChineseMatch) {
    const dayChar = weeklyChineseMatch[1];
    const period = weeklyChineseMatch[2];
    const hourStr = weeklyChineseMatch[3];

    const dayOfWeek = weekdayChineseMap[dayChar];
    let hour = 9; // default

    if (period && hourStr) {
      hour = parseInt(hourStr, 10);
      if ((period === '下午' || period === '晚上') && hour !== 12) {
        hour += 12;
      }
      if ((period === '早上' || period === '上午') && hour === 12) {
        hour = 0;
      }
    }

    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    return {
      schedule_type: 'cron',
      schedule_value: `0 ${hour} * * ${dayOfWeek}`,
      description: `每週${dayNames[dayOfWeek]} ${hour}:00`
    };
  }

  // English: every monday/tuesday/... (with optional time)
  const weekdayEnglishMap: Record<string, number> = {
    'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
    'friday': 5, 'saturday': 6, 'sunday': 0
  };

  const weeklyEnglishMatch = normalized.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(am|pm))?/);
  if (weeklyEnglishMatch) {
    const dayName = weeklyEnglishMatch[1];
    const hourStr = weeklyEnglishMatch[2];
    const period = weeklyEnglishMatch[3];

    const dayOfWeek = weekdayEnglishMap[dayName];
    let hour = 9; // default

    if (hourStr && period) {
      hour = parseInt(hourStr, 10);
      if (period === 'pm' && hour !== 12) {
        hour += 12;
      }
      if (period === 'am' && hour === 12) {
        hour = 0;
      }
    }

    const dayNameCap = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    return {
      schedule_type: 'cron',
      schedule_value: `0 ${hour} * * ${dayOfWeek}`,
      description: `Every ${dayNameCap} at ${hour % 12 || 12}:00 ${hour >= 12 ? 'PM' : 'AM'}`
    };
  }

  // Chinese: 每月N號
  const monthlyChineseMatch = normalized.match(/每月(\d{1,2})號/);
  if (monthlyChineseMatch) {
    const day = parseInt(monthlyChineseMatch[1], 10);

    return {
      schedule_type: 'cron',
      schedule_value: `0 9 ${day} * *`,
      description: `每月 ${day} 號 9:00`
    };
  }

  // English: every month on the Xst/Xnd/Xrd/Xth
  const monthlyEnglishMatch = normalized.match(/every\s+month\s+on\s+the\s+(\d{1,2})(st|nd|rd|th)/);
  if (monthlyEnglishMatch) {
    const day = parseInt(monthlyEnglishMatch[1], 10);

    return {
      schedule_type: 'cron',
      schedule_value: `0 9 ${day} * *`,
      description: `Every month on the ${monthlyEnglishMatch[1]}${monthlyEnglishMatch[2]} at 9:00 AM`
    };
  }

  // Chinese: N分鐘後 / N小時後
  const onceChineseMatch = normalized.match(/(\d+)(分鐘|小時)後/);
  if (onceChineseMatch) {
    const num = parseInt(onceChineseMatch[1], 10);
    const unit = onceChineseMatch[2];
    const ms = unit === '小時' ? num * 3600000 : num * 60000;
    const targetTime = new Date(Date.now() + ms).toISOString();

    return {
      schedule_type: 'once',
      schedule_value: targetTime,
      description: `${num} ${unit}後`
    };
  }

  // English: in N minutes / in N hours
  const onceEnglishMatch = normalized.match(/in\s+(\d+)\s+(minute|hour)s?/);
  if (onceEnglishMatch) {
    const num = parseInt(onceEnglishMatch[1], 10);
    const unit = onceEnglishMatch[2];
    const ms = unit === 'hour' ? num * 3600000 : num * 60000;
    const targetTime = new Date(Date.now() + ms).toISOString();

    return {
      schedule_type: 'once',
      schedule_value: targetTime,
      description: `In ${num} ${unit}${num > 1 ? 's' : ''}`
    };
  }

  // English: tomorrow at Xam/Xpm
  const tomorrowMatch = normalized.match(/tomorrow\s+at\s+(\d{1,2})(am|pm)/);
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1], 10);
    const period = tomorrowMatch[2];

    if (period === 'pm' && hour !== 12) {
      hour += 12;
    }
    if (period === 'am' && hour === 12) {
      hour = 0;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(hour, 0, 0, 0);

    return {
      schedule_type: 'once',
      schedule_value: tomorrow.toISOString(),
      description: `Tomorrow at ${tomorrowMatch[1]}${period.toUpperCase()}`
    };
  }

  return null;
}
