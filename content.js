// 内容脚本 - 注入到所有网页中
class SignInContentScript {
  constructor() {
    this.init();
  }

  init() {
    // 监听来自后台脚本的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'performSignIn') {
        this.performSignIn(message.selector)
          .then(result => sendResponse({ success: true, result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // 异步响应
      }
    });
  }

  async performSignIn(selector) {
    try {
      console.log('开始执行签到操作，选择器:', selector);
      
      // 等待元素出现
      const element = await this.waitForElement(selector);
      
      if (!element) {
        throw new Error(`未找到签到元素: ${selector}`);
      }

      // 检查元素是否可见和可点击
      if (!this.isElementClickable(element)) {
        throw new Error('签到元素不可点击');
      }

      // 滚动到元素位置
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // 等待一下确保滚动完成
      await this.sleep(500);

      // 尝试多种点击方式
      const success = await this.clickElement(element);
      
      if (success) {
        console.log('签到操作执行成功');
        
        // 等待页面响应
        await this.sleep(2000);
        
        // 检查是否有成功提示
        const successMessage = this.checkSignInResult();
        
        return {
          success: true,
          message: successMessage || '签到完成',
          timestamp: new Date().toLocaleString()
        };
      } else {
        throw new Error('点击签到元素失败');
      }
      
    } catch (error) {
      console.error('签到失败:', error);
      throw error;
    }
  }

  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // 首先检查元素是否已经存在
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      // 如果不存在，使用 MutationObserver 监听
      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      // 设置超时
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`等待元素超时: ${selector}`));
      }, timeout);
    });
  }

  isElementClickable(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !element.disabled
    );
  }

  async clickElement(element) {
    try {
      // 方法1: 直接点击
      element.click();
      await this.sleep(100);
      
      // 方法2: 如果直接点击无效，尝试事件派发
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(clickEvent);
      
      // 方法3: 尝试触发其他相关事件
      const events = ['mousedown', 'mouseup', 'touchstart', 'touchend'];
      for (const eventType of events) {
        const event = new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window
        });
        element.dispatchEvent(event);
        await this.sleep(50);
      }
      
      return true;
    } catch (error) {
      console.error('点击元素失败:', error);
      return false;
    }
  }

  checkSignInResult() {
    // 常见的签到成功提示关键词
    const successKeywords = [
      '签到成功', '打卡成功', '签到完成', '打卡完成',
      '今日已签到', '今日已打卡', '连续签到', '获得',
      'success', 'complete', 'done'
    ];

    // 检查页面中是否有成功提示
    const bodyText = document.body.innerText.toLowerCase();
    
    for (const keyword of successKeywords) {
      if (bodyText.includes(keyword.toLowerCase())) {
        return `检测到签到成功提示: ${keyword}`;
      }
    }

    // 检查是否有弹窗或通知
    const notifications = document.querySelectorAll([
      '.notification', '.alert', '.toast', '.message', 
      '.success', '.tips', '.popup'
    ].join(','));

    for (const notification of notifications) {
      const text = notification.innerText.toLowerCase();
      for (const keyword of successKeywords) {
        if (text.includes(keyword.toLowerCase())) {
          return `检测到签到成功通知: ${keyword}`;
        }
      }
    }

    return null;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 初始化内容脚本
if (typeof window !== 'undefined' && !window.signinContentScript) {
  window.signinContentScript = new SignInContentScript();
}