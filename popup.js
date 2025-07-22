// 弹出窗口的JavaScript逻辑
class SignInManager {
  constructor() {
    this.tasks = [];
    this.logs = [];
    this.currentEditingTask = null;
    this.currentView = 'tasks';
    this.init();
  }

  async init() {
    await this.loadTasks();
    await this.loadLogs();
    this.renderTasks();
    this.bindEvents();
  }

  async loadTasks() {
    const result = await chrome.storage.sync.get(['signinTasks']);
    this.tasks = result.signinTasks || [];
  }

  async loadLogs() {
    const result = await chrome.storage.sync.get(['signinLogs']);
    this.logs = result.signinLogs || [];
  }

  async saveTasks() {
    await chrome.storage.sync.set({ signinTasks: this.tasks });
    // 通知后台脚本更新定时器
    chrome.runtime.sendMessage({ action: 'updateSchedules' });
  }

  async saveLogs() {
    // 限制日志数量，只保留最近100条
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }
    await chrome.storage.sync.set({ signinLogs: this.logs });
  }

  renderTasks() {
    const taskList = document.getElementById('task-list');
    
    if (this.tasks.length === 0) {
      taskList.innerHTML = `
        <div class="empty-state">
          <p>暂无签到任务</p>
          <p>点击右上角"添加任务"按钮开始创建</p>
        </div>
      `;
      return;
    }

    taskList.innerHTML = this.tasks.map((task, index) => `
      <div class="task-item">
        <div class="task-status ${task.enabled ? 'enabled' : 'disabled'}"></div>
        <div class="task-info">
          <div class="task-name">${task.name}</div>
          <div class="task-url">${this.truncateUrl(task.url)}</div>
          <div class="task-schedule">${this.formatSchedule(task)}</div>
          ${task.lastRun ? `<div class="task-last-run">上次执行: ${new Date(task.lastRun).toLocaleString()}</div>` : ''}
        </div>
        <div class="task-actions">
          <button class="btn-small btn-run" onclick="signinManager.manualRun(${index})" title="立即执行">执行</button>
          <button class="btn-small btn-logs" onclick="signinManager.viewTaskLogs(${index})" title="查看记录">记录</button>
          <button class="btn-small btn-toggle" onclick="signinManager.toggleTask(${index})">
            ${task.enabled ? '禁用' : '启用'}
          </button>
          <button class="btn-small btn-edit" onclick="signinManager.editTask(${index})">编辑</button>
          <button class="btn-small btn-delete" onclick="signinManager.deleteTask(${index})">删除</button>
        </div>
      </div>
    `).join('');
  }

  truncateUrl(url) {
    return url.length > 40 ? url.substring(0, 40) + '...' : url;
  }

  formatSchedule(task) {
    if (task.scheduleType === 'cron') {
      return `Cron: ${task.cronExpression}`;
    } else {
      const unitMap = { minutes: '分钟', hours: '小时', days: '天' };
      return `每 ${task.intervalValue} ${unitMap[task.intervalUnit]}`;
    }
  }

  bindEvents() {
    // 添加任务按钮
    document.getElementById('add-task-btn').addEventListener('click', () => {
      this.showTaskModal();
    });

    // 查看记录按钮
    document.getElementById('view-logs-btn').addEventListener('click', () => {
      this.showLogsView();
    });

    // 返回任务列表
    document.getElementById('back-to-tasks').addEventListener('click', () => {
      this.showTasksView();
    });

    // 清空记录
    document.getElementById('clear-logs').addEventListener('click', () => {
      this.clearLogs();
    });

    // 模态框关闭
    document.querySelector('.close').addEventListener('click', () => {
      this.hideTaskModal();
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      this.hideTaskModal();
    });

    // 点击模态框外部关闭
    document.getElementById('task-modal').addEventListener('click', (e) => {
      if (e.target.id === 'task-modal') {
        this.hideTaskModal();
      }
    });

    // 调度类型切换
    document.getElementById('schedule-type').addEventListener('change', (e) => {
      this.toggleScheduleConfig(e.target.value);
    });

    // Cron表达式验证
    document.getElementById('validate-cron').addEventListener('click', () => {
      this.validateCronExpression();
    });

    // Cron表达式输入时实时验证
    document.getElementById('cron-expression').addEventListener('input', () => {
      this.validateCronExpression();
    });

    // 表单提交
    document.getElementById('task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveTask();
    });

    // 初始化Cron示例
    this.initCronExamples();
  }

  showTaskModal(task = null) {
    this.currentEditingTask = task;
    const modal = document.getElementById('task-modal');
    const modalTitle = document.getElementById('modal-title');
    
    if (task) {
      modalTitle.textContent = '编辑任务';
      this.fillTaskForm(task);
    } else {
      modalTitle.textContent = '添加任务';
      this.resetTaskForm();
    }
    
    modal.classList.remove('hidden');
  }

  hideTaskModal() {
    document.getElementById('task-modal').classList.add('hidden');
    this.currentEditingTask = null;
  }

  fillTaskForm(task) {
    document.getElementById('task-name').value = task.name;
    document.getElementById('website-url').value = task.url;
    document.getElementById('signin-selector').value = task.selector;
    document.getElementById('schedule-type').value = task.scheduleType;
    document.getElementById('task-enabled').checked = task.enabled;

    if (task.scheduleType === 'interval') {
      document.getElementById('interval-value').value = task.intervalValue;
      document.getElementById('interval-unit').value = task.intervalUnit;
    } else {
      document.getElementById('cron-expression').value = task.cronExpression;
    }

    this.toggleScheduleConfig(task.scheduleType);
  }

  resetTaskForm() {
    document.getElementById('task-form').reset();
    document.getElementById('task-enabled').checked = true;
    document.getElementById('interval-value').value = 1;
    document.getElementById('interval-unit').value = 'hours';
    this.toggleScheduleConfig('interval');
  }

  toggleScheduleConfig(type) {
    const intervalConfig = document.getElementById('interval-config');
    const cronConfig = document.getElementById('cron-config');
    
    if (type === 'interval') {
      intervalConfig.classList.remove('hidden');
      cronConfig.classList.add('hidden');
    } else {
      intervalConfig.classList.add('hidden');
      cronConfig.classList.remove('hidden');
    }
  }

  async saveTask() {
    const formData = this.getFormData();
    
    if (!this.validateForm(formData)) {
      return;
    }

    const task = {
      id: this.currentEditingTask?.id || Date.now().toString(),
      name: formData.name,
      url: formData.url,
      selector: formData.selector,
      scheduleType: formData.scheduleType,
      enabled: formData.enabled,
      lastRun: null,
      nextRun: null
    };

    if (formData.scheduleType === 'interval') {
      task.intervalValue = parseInt(formData.intervalValue);
      task.intervalUnit = formData.intervalUnit;
    } else {
      task.cronExpression = formData.cronExpression;
    }

    if (this.currentEditingTask) {
      const index = this.tasks.findIndex(t => t.id === this.currentEditingTask.id);
      this.tasks[index] = task;
    } else {
      this.tasks.push(task);
    }

    await this.saveTasks();
    this.renderTasks();
    this.hideTaskModal();
  }

  getFormData() {
    return {
      name: document.getElementById('task-name').value.trim(),
      url: document.getElementById('website-url').value.trim(),
      selector: document.getElementById('signin-selector').value.trim(),
      scheduleType: document.getElementById('schedule-type').value,
      intervalValue: document.getElementById('interval-value').value,
      intervalUnit: document.getElementById('interval-unit').value,
      cronExpression: document.getElementById('cron-expression').value.trim(),
      enabled: document.getElementById('task-enabled').checked
    };
  }

  validateForm(formData) {
    if (!formData.name) {
      alert('请输入任务名称');
      return false;
    }
    
    if (!formData.url) {
      alert('请输入网站URL');
      return false;
    }
    
    if (!formData.selector) {
      alert('请输入签到按钮选择器');
      return false;
    }

    if (formData.scheduleType === 'cron') {
      if (!formData.cronExpression) {
        alert('请输入Cron表达式');
        return false;
      }
      
      const validation = CronParser.validateExpression(formData.cronExpression);
      if (!validation.valid) {
        alert(`Cron表达式错误: ${validation.message}`);
        return false;
      }
    }

    return true;
  }

  validateCronExpression() {
    const cronExpression = document.getElementById('cron-expression').value.trim();
    const validationDiv = document.getElementById('cron-validation');
    
    if (!cronExpression) {
      validationDiv.innerHTML = '';
      validationDiv.className = 'cron-validation';
      return;
    }

    const validation = CronParser.validateExpression(cronExpression);
    
    validationDiv.className = `cron-validation ${validation.valid ? 'valid' : 'invalid'}`;
    validationDiv.innerHTML = validation.message;
  }

  initCronExamples() {
    const examplesContainer = document.getElementById('cron-examples');
    const examples = CronParser.getExamples();
    
    examplesContainer.innerHTML = examples.map(example => `
      <div class="cron-example" onclick="signinManager.selectCronExample('${example.expression}')">
        <code>${example.expression}</code>
        <span>${example.description}</span>
      </div>
    `).join('');
  }

  selectCronExample(expression) {
    document.getElementById('cron-expression').value = expression;
    this.validateCronExpression();
  }

  async toggleTask(index) {
    this.tasks[index].enabled = !this.tasks[index].enabled;
    await this.saveTasks();
    this.renderTasks();
  }

  editTask(index) {
    this.showTaskModal(this.tasks[index]);
  }

  async deleteTask(index) {
    if (confirm('确定要删除这个任务吗？')) {
      this.tasks.splice(index, 1);
      await this.saveTasks();
      this.renderTasks();
    }
  }

  // 视图切换功能
  showLogsView() {
    this.currentView = 'logs';
    document.getElementById('main-view').classList.add('hidden');
    document.getElementById('logs-view').classList.remove('hidden');
    this.renderLogs();
  }

  showTasksView() {
    this.currentView = 'tasks';
    document.getElementById('logs-view').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
  }

  // 手动执行功能
  async manualRun(index) {
    const task = this.tasks[index];
    const button = document.querySelectorAll('.btn-run')[index];
    
    // 更新按钮状态
    const originalText = button.textContent;
    button.textContent = '执行中...';
    button.disabled = true;

    try {
      // 发送消息给后台脚本执行签到
      const response = await chrome.runtime.sendMessage({
        action: 'manualSignIn',
        taskId: task.id
      });

      // 添加执行记录
      this.addLog({
        taskId: task.id,
        taskName: task.name,
        url: task.url,
        type: 'manual',
        status: response.success ? 'success' : 'error',
        message: response.message || (response.success ? '手动执行成功' : '手动执行失败'),
        timestamp: new Date().toISOString()
      });

      // 更新任务的最后执行时间
      if (response.success) {
        task.lastRun = new Date().toISOString();
        await this.saveTasks();
        this.renderTasks();
      }

    } catch (error) {
      console.error('手动执行失败:', error);
      
      // 添加错误记录
      this.addLog({
        taskId: task.id,
        taskName: task.name,
        url: task.url,
        type: 'manual',
        status: 'error',
        message: `执行错误: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    } finally {
      // 恢复按钮状态
      button.textContent = originalText;
      button.disabled = false;
    }
  }

  // 查看特定任务的记录
  viewTaskLogs(index) {
    const task = this.tasks[index];
    this.showLogsView();
    this.renderLogs(task.id);
  }

  // 渲染执行记录
  renderLogs(taskIdFilter = null) {
    const logsList = document.getElementById('logs-list');
    let filteredLogs = this.logs;
    
    if (taskIdFilter) {
      filteredLogs = this.logs.filter(log => log.taskId === taskIdFilter);
    }

    if (filteredLogs.length === 0) {
      logsList.innerHTML = `
        <div class="logs-empty">
          <p>${taskIdFilter ? '该任务暂无执行记录' : '暂无执行记录'}</p>
        </div>
      `;
      return;
    }

    // 按时间倒序排列
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    logsList.innerHTML = filteredLogs.map(log => `
      <div class="log-item">
        <div class="log-header">
          <div class="log-task-name">${log.taskName}</div>
          <div class="log-time">${new Date(log.timestamp).toLocaleString()}</div>
        </div>
        <div style="margin-bottom: 4px;">
          <span class="log-status ${log.status} ${log.type}">${this.getStatusText(log)}</span>
        </div>
        <div class="log-message">${log.message}</div>
        <div class="log-url">${log.url}</div>
      </div>
    `).join('');
  }

  getStatusText(log) {
    const statusMap = {
      success: '成功',
      error: '失败'
    };
    const typeMap = {
      manual: '手动',
      auto: '自动'
    };
    
    return `${typeMap[log.type] || ''}${statusMap[log.status] || ''}`;
  }

  // 添加日志记录
  async addLog(logEntry) {
    this.logs.unshift(logEntry);
    await this.saveLogs();
    
    // 如果当前在日志视图，实时更新显示
    if (this.currentView === 'logs') {
      this.renderLogs();
    }
  }

  // 清空记录
  async clearLogs() {
    if (confirm('确定要清空所有执行记录吗？')) {
      this.logs = [];
      await this.saveLogs();
      this.renderLogs();
    }
  }
}

// 初始化
let signinManager;
document.addEventListener('DOMContentLoaded', () => {
  signinManager = new SignInManager();
});