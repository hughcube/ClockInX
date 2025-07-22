// Cron表达式解析库
class CronParser {
  static parse(cronExpression) {
    try {
      const parts = cronExpression.trim().split(/\s+/);
      
      if (parts.length !== 5) {
        throw new Error('Cron表达式必须包含5个部分: 分 时 日 月 周');
      }

      const [minute, hour, day, month, weekday] = parts;
      
      return {
        minute: this.parseField(minute, 0, 59),
        hour: this.parseField(hour, 0, 23),
        day: this.parseField(day, 1, 31),
        month: this.parseField(month, 1, 12),
        weekday: this.parseField(weekday, 0, 6) // 0 = 周日
      };
    } catch (error) {
      throw new Error(`Cron表达式解析错误: ${error.message}`);
    }
  }

  static parseField(field, min, max) {
    if (field === '*') {
      return { type: 'any' };
    }

    // 处理数字
    if (/^\d+$/.test(field)) {
      const num = parseInt(field);
      if (num < min || num > max) {
        throw new Error(`数值 ${num} 超出范围 ${min}-${max}`);
      }
      return { type: 'specific', value: num };
    }

    // 处理范围 (例: 1-5)
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(s => parseInt(s));
      if (start < min || end > max || start > end) {
        throw new Error(`范围 ${field} 无效`);
      }
      return { type: 'range', start, end };
    }

    // 处理列表 (例: 1,3,5)
    if (field.includes(',')) {
      const values = field.split(',').map(s => parseInt(s));
      for (const val of values) {
        if (val < min || val > max) {
          throw new Error(`列表中的值 ${val} 超出范围 ${min}-${max}`);
        }
      }
      return { type: 'list', values };
    }

    // 处理步长 (例: */5, 0-23/2)
    if (field.includes('/')) {
      const [base, step] = field.split('/');
      const stepValue = parseInt(step);
      
      if (base === '*') {
        return { type: 'step', start: min, end: max, step: stepValue };
      } else if (base.includes('-')) {
        const [start, end] = base.split('-').map(s => parseInt(s));
        return { type: 'step', start, end, step: stepValue };
      }
    }

    throw new Error(`无法解析字段: ${field}`);
  }

  static getNextExecution(cronExpression, fromTime = null) {
    const parsed = this.parse(cronExpression);
    const from = fromTime ? new Date(fromTime) : new Date();
    
    // 从下一分钟开始计算
    const next = new Date(from);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // 最多向前查找一年
    const maxIterations = 366 * 24 * 60;
    let iterations = 0;

    while (iterations < maxIterations) {
      if (this.matchesTime(next, parsed)) {
        return next;
      }
      
      next.setMinutes(next.getMinutes() + 1);
      iterations++;
    }

    throw new Error('无法找到下一个执行时间');
  }

  static matchesTime(date, parsed) {
    return this.matchesField(date.getMinutes(), parsed.minute) &&
           this.matchesField(date.getHours(), parsed.hour) &&
           this.matchesField(date.getDate(), parsed.day) &&
           this.matchesField(date.getMonth() + 1, parsed.month) &&
           this.matchesField(date.getDay(), parsed.weekday);
  }

  static matchesField(value, field) {
    switch (field.type) {
      case 'any':
        return true;
      
      case 'specific':
        return value === field.value;
      
      case 'range':
        return value >= field.start && value <= field.end;
      
      case 'list':
        return field.values.includes(value);
      
      case 'step':
        if (value < field.start || value > field.end) {
          return false;
        }
        return (value - field.start) % field.step === 0;
      
      default:
        return false;
    }
  }

  static validateExpression(cronExpression) {
    try {
      this.parse(cronExpression);
      const nextTime = this.getNextExecution(cronExpression);
      return {
        valid: true,
        nextExecution: nextTime,
        message: `下次执行时间: ${nextTime.toLocaleString()}`
      };
    } catch (error) {
      return {
        valid: false,
        message: error.message
      };
    }
  }

  // 获取常用的cron表达式示例
  static getExamples() {
    return [
      { expression: '0 9 * * *', description: '每天9点' },
      { expression: '0 9 * * 1-5', description: '工作日9点' },
      { expression: '0 */2 * * *', description: '每2小时' },
      { expression: '30 8 * * *', description: '每天8点30分' },
      { expression: '0 9 1 * *', description: '每月1号9点' },
      { expression: '0 9 * * 1', description: '每周一9点' },
      { expression: '*/30 * * * *', description: '每30分钟' },
      { expression: '0 6,12,18 * * *', description: '每天6点、12点、18点' }
    ];
  }
}

// 导出给其他脚本使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CronParser;
}

// 在浏览器环境中添加到window对象
if (typeof window !== 'undefined') {
  window.CronParser = CronParser;
}