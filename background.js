// 后台脚本 - Service Worker
// 导入CronParser
importScripts('cron-parser.js');

class SignInScheduler {
  constructor() {
    this.tasks = [];
    this.alarms = new Set();
    this.init();
  }

  init() {
    // 插件启动时加载任务
    this.loadTasks();
    
    // 监听来自弹出窗口的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'updateSchedules') {
        this.updateSchedules();
      } else if (message.action === 'manualSignIn') {
        this.handleManualSignIn(message.taskId)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, message: error.message }));
        return true; // 异步响应
      }
    });

    // 监听定时器触发
    chrome.alarms.onAlarm.addListener((alarm) => {
      this.handleAlarm(alarm);
    });

    // 插件安装时初始化
    chrome.runtime.onInstalled.addListener(() => {
      this.updateSchedules();
    });
  }

  async loadTasks() {
    const result = await chrome.storage.sync.get(['signinTasks']);
    this.tasks = result.signinTasks || [];
    this.updateSchedules();
  }

  async updateSchedules() {
    await this.loadTasks();
    
    // 清除所有现有的定时器
    const allAlarms = await chrome.alarms.getAll();
    for (const alarm of allAlarms) {
      if (alarm.name.startsWith('signin_')) {
        await chrome.alarms.clear(alarm.name);
      }
    }
    this.alarms.clear();

    // 为每个启用的任务创建定时器
    for (const task of this.tasks) {
      if (task.enabled) {
        await this.createAlarmForTask(task);
      }
    }
  }

  async createAlarmForTask(task) {
    const alarmName = `signin_${task.id}`;
    
    if (task.scheduleType === 'interval') {
      const delayInMinutes = this.convertToMinutes(task.intervalValue, task.intervalUnit);
      
      await chrome.alarms.create(alarmName, {
        delayInMinutes: delayInMinutes,
        periodInMinutes: delayInMinutes
      });
    } else if (task.scheduleType === 'cron') {
      // 计算下一次执行时间
      const nextRun = this.getNextCronExecution(task.cronExpression);
      const delayInMinutes = Math.max(1, Math.floor((nextRun - Date.now()) / (1000 * 60)));
      
      await chrome.alarms.create(alarmName, {
        delayInMinutes: delayInMinutes
      });
    }
    
    this.alarms.add(alarmName);
  }

  convertToMinutes(value, unit) {
    switch (unit) {
      case 'minutes': return value;
      case 'hours': return value * 60;
      case 'days': return value * 60 * 24;
      default: return value;
    }
  }

  getNextCronExecution(cronExpression) {
    try {
      return CronParser.getNextExecution(cronExpression).getTime();
    } catch (error) {
      console.error('Cron parsing error:', error);
      // 默认1小时后执行
      return Date.now() + (60 * 60 * 1000);
    }
  }

  async handleAlarm(alarm) {
    if (!alarm.name.startsWith('signin_')) return;

    const taskId = alarm.name.replace('signin_', '');
    const task = this.tasks.find(t => t.id === taskId);
    
    if (!task || !task.enabled) return;

    console.log(`执行签到任务: ${task.name}`);
    
    try {
      // 执行签到
      const result = await this.executeSignIn(task);
      
      // 记录执行结果
      await this.addExecutionLog({
        taskId: taskId,
        taskName: task.name,
        url: task.url,
        type: 'auto',
        status: result.success ? 'success' : 'error',
        message: result.message || (result.success ? '自动签到成功' : '自动签到失败'),
        timestamp: new Date().toISOString()
      });
      
      // 更新最后执行时间
      await this.updateTaskLastRun(taskId);
      
      // 如果是cron任务，需要重新创建下一次的定时器
      if (task.scheduleType === 'cron') {
        await chrome.alarms.clear(alarm.name);
        await this.createAlarmForTask(task);
      }
      
    } catch (error) {
      console.error(`签到任务执行失败: ${task.name}`, error);
      
      // 记录执行错误
      await this.addExecutionLog({
        taskId: taskId,
        taskName: task.name,
        url: task.url,
        type: 'auto',
        status: 'error',
        message: `执行失败: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  async executeSignIn(task) {
    return new Promise(async (resolve, reject) => {
      try {
        // 查找是否已有该网站的标签页
        const tabs = await chrome.tabs.query({ url: task.url + '*' });
        let targetTab;

        if (tabs.length > 0) {
          // 使用现有标签页
          targetTab = tabs[0];
          await chrome.tabs.update(targetTab.id, { active: true });
        } else {
          // 创建新标签页
          targetTab = await chrome.tabs.create({
            url: task.url,
            active: false // 后台执行
          });
        }

        // 等待页面加载完成
        chrome.tabs.onUpdated.addListener(function tabUpdateListener(tabId, changeInfo) {
          if (tabId === targetTab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(tabUpdateListener);
            
            // 注入并执行签到脚本
            chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              func: this.performSignIn,
              args: [task.selector]
            }, (results) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
              }
              
              if (results && results[0] && results[0].result) {
                resolve(results[0].result);
              } else {
                resolve({ success: false, message: '签到脚本执行失败' });
              }
            });
          }
        }.bind(this));

      } catch (error) {
        reject(error);
      }
    });
  }

  // 这个函数会被注入到目标页面中执行
  performSignIn(selector) {
    return new Promise((resolve, reject) => {
      try {
        // 等待元素出现
        const waitForElement = (selector, timeout = 10000) => {
          return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
              resolve(element);
              return;
            }

            const observer = new MutationObserver(() => {
              const element = document.querySelector(selector);
              if (element) {
                observer.disconnect();
                resolve(element);
              }
            });

            observer.observe(document.body, {
              childList: true,
              subtree: true
            });

            setTimeout(() => {
              observer.disconnect();
              reject(new Error('等待签到元素超时'));
            }, timeout);
          });
        };

        waitForElement(selector)
          .then(element => {
            // 模拟点击
            element.click();
            
            // 等待一下看是否有反馈
            setTimeout(() => {
              resolve({ success: true, message: '签到完成' });
            }, 2000);
          })
          .catch(error => {
            reject(error);
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  async updateTaskLastRun(taskId) {
    const result = await chrome.storage.sync.get(['signinTasks']);
    const tasks = result.signinTasks || [];
    
    const taskIndex = tasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      tasks[taskIndex].lastRun = new Date().toISOString();
      await chrome.storage.sync.set({ signinTasks: tasks });
      this.tasks = tasks;
    }
  }

  // 手动执行签到
  async handleManualSignIn(taskId) {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error('任务不存在');
    }

    console.log(`手动执行签到任务: ${task.name}`);
    
    try {
      const result = await this.executeSignIn(task);
      
      // 记录执行结果
      await this.addExecutionLog({
        taskId: taskId,
        taskName: task.name,
        url: task.url,
        type: 'manual',
        status: result.success ? 'success' : 'error',
        message: result.message || (result.success ? '手动签到成功' : '手动签到失败'),
        timestamp: new Date().toISOString()
      });

      // 如果成功，更新最后执行时间
      if (result.success) {
        await this.updateTaskLastRun(taskId);
      }

      return {
        success: result.success,
        message: result.message || (result.success ? '手动执行成功' : '手动执行失败')
      };
      
    } catch (error) {
      console.error('手动签到执行失败:', error);
      
      // 记录执行错误
      await this.addExecutionLog({
        taskId: taskId,
        taskName: task.name,
        url: task.url,
        type: 'manual',
        status: 'error',
        message: `手动执行失败: ${error.message}`,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }

  // 添加执行日志
  async addExecutionLog(logEntry) {
    const result = await chrome.storage.sync.get(['signinLogs']);
    const logs = result.signinLogs || [];
    
    logs.unshift(logEntry);
    
    // 限制日志数量，只保留最近100条
    if (logs.length > 100) {
      logs.splice(100);
    }
    
    await chrome.storage.sync.set({ signinLogs: logs });
  }
}

// 初始化调度器
const scheduler = new SignInScheduler();