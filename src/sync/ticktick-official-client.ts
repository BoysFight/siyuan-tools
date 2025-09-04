/**
 * TickTick官方API客户端
 * 基于官方REST API实现，使用OAuth2认证
 */
export interface TickTickOfficialConfig {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    apiBaseUrl?: string;
}

export interface TickTickTask {
    id?: string;
    title: string;
    content?: string;
    projectId?: string;
    startDate?: string;
    dueDate?: string;
    priority?: number; // 0=无，1=低，3=中，5=高
    status?: number; // 0=未完成，2=已完成
    tags?: string[];
    isAllDay?: boolean;
}

export interface TickTickProject {
    id: string;
    name: string;
    color?: string;
    isOwner?: boolean;
}

export interface TickTickProjectData {
    project: TickTickProject & {
        closed: boolean;
        groupId?: string;
        viewMode: string;
        kind: string;
    };
    tasks: (TickTickTask & {
        isAllDay?: boolean;
        desc?: string;
        timeZone?: string;
        repeatFlag?: string;
        reminders?: string[];
        completedTime?: string;
        sortOrder?: number;
        items?: {
            id: string;
            status: number;
            title: string;
            sortOrder: number;
            startDate?: string;
            isAllDay: boolean;
            timeZone: string;
            completedTime?: string;
        }[];
    })[];
    columns?: {
        id: string;
        projectId: string;
        name: string;
        sortOrder: number;
    }[];
}

export class TickTickOfficialClient {
    private config: TickTickOfficialConfig;
    private baseUrl: string;
    private lastRequestTime: number = 0;
    private minRequestInterval: number = 1000; // 最小请求间隔1000ms

    constructor(config: TickTickOfficialConfig) {
        this.config = config;
        this.baseUrl = config.apiBaseUrl || 'https://api.dida365.com/open/v1';
    }

    private async waitForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.lastRequestTime = Date.now();
    }

    /**
     * 设置访问令牌
     */
    setAccessToken(token: string) {
        this.config.accessToken = token;
    }

    /**
     * 获取OAuth授权URL
     */
    getAuthorizationUrl(redirectUri: string, state?: string): string {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'tasks:write tasks:read',
            state: state || 'default'
        });
        return `https://dida365.com/oauth/authorize?${params.toString()}`;
    }

    /**
     * 通过授权码获取访问令牌
     */
    async getAccessToken(code: string, redirectUri: string): Promise<any> {
        const response = await fetch('https://dida365.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            })
        });

        if (!response.ok) {
            throw new Error(`OAuth token request failed: ${response.statusText}`);
        }

        const tokenData = await response.json();
        this.config.accessToken = tokenData.access_token;
        this.config.refreshToken = tokenData.refresh_token;
        return tokenData;
    }

    /**
     * 发送API请求的通用方法
     */
    private async request(endpoint: string, options: RequestInit = {}, retryCount: number = 0): Promise<any> {
        const maxRetries = 3; // 最大重试次数

        if (!this.config.accessToken) {
            throw new Error('Access token is required. Please authenticate first.');
        }

        const url = `${this.baseUrl}/${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers
        };

        let result: any;

        try {
            // 等待限流
            await this.waitForRateLimit();
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`TickTick API request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            // 检查响应内容类型和长度
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                // 如果不是 JSON 响应，返回原始文本或空对象
                const text = await response.text();
                result = text || {};
            } else {
                try {
                    result = await response.json();
                } catch (jsonError) {
                    console.error(`JSON 解析错误: ${jsonError.message}`, jsonError);
                    // 返回空对象而不是抛出错误，避免中断执行流程
                    result = {};
                }
            }

        } catch (error) {
            // 如果是限流错误，增加等待时间后重试
            if (error.message.includes('exceed_query_limit') && retryCount < maxRetries) {
                const waitTime = Math.min(this.minRequestInterval * Math.pow(2, retryCount), 30000); // 指数退避，最大30秒
                console.log(`遇到限流，第${retryCount + 1}次重试${url}，等待${waitTime}ms后重试...`);

                // 更新请求间隔
                this.minRequestInterval = Math.min(this.minRequestInterval * 1.5, 10000);

                await new Promise(resolve => setTimeout(resolve, waitTime));

                // 递归重试，增加重试计数
                return this.request(endpoint, options, retryCount + 1);
            }

            // 如果达到最大重试次数或不是限流错误，抛出异常
            if (retryCount >= maxRetries && error.message.includes('exceed_query_limit')) {
                throw new Error(`API请求失败: 已达到最大重试次数(${maxRetries})，仍然遇到限流错误`);
            }

            throw error;
        }

        return result;
    }

    /**
     * 创建任务
     */
    async createTask(task: TickTickTask): Promise<TickTickTask> {
        const taskData = {
            title: task.title,
            content: task.content || '',
            projectId: task.projectId,
            startDate: task.startDate,
            dueDate: task.dueDate,
            priority: task.priority || 0,
            status: task.status || 0,
            tags: task.tags || [],
            isAllDay: task.isAllDay
        };

        const result = await this.request('task', {
            method: 'POST',
            body: JSON.stringify(taskData)
        });

        return result;
    }

    /**
     * 更新任务
     */
    async updateTask(taskId: string, task: Partial<TickTickTask>): Promise<TickTickTask> {
        const taskData = {
            id: taskId,
            ...task
        };

        const result = await this.request(`task/${taskId}`, {
            method: 'POST', // TickTick使用POST进行更新
            body: JSON.stringify(taskData)
        });

        if (task.status === 2) {
            await this.completeTask(task.projectId!, taskId);
        }

        return result;
    }

    /**
     * 获取任务详情
     */
    async getTask(taskId: string): Promise<TickTickTask> {
        return this.request(`task/${taskId}`);
    }

    /**
     * 删除任务
     */
    async deleteTask(projectId: string, taskId: string): Promise<void> {
        await this.request(`project/${projectId}/task/${taskId}`, {
            method: 'DELETE'
        });
    }

    /**
     * 完成任务
     */
    async completeTask(projectId: string, taskId: string): Promise<TickTickTask> {
        return this.request(`project/${projectId}/task/${taskId}/complete`, {
            method: 'POST'
        });
    }

    /**
     * 获取项目列表
     */
    async getProjects(): Promise<TickTickProject[]> {
        return this.request('project');
    }

    /**
     * 获取项目详情
     */
    async getProject(projectId: string): Promise<TickTickProject> {
        return this.request(`project/${projectId}`);
    }

    /**
     * 刷新访问令牌
     */
    async refreshAccessToken(): Promise<any> {
        if (!this.config.refreshToken) {
            throw new Error('Refresh token is required');
        }

        const response = await fetch('https://dida365.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                refresh_token: this.config.refreshToken,
                grant_type: 'refresh_token'
            })
        });

        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.statusText}`);
        }

        const tokenData = await response.json();
        this.config.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
            this.config.refreshToken = tokenData.refresh_token;
        }
        return tokenData;
    }

    /**
     * 获取项目中的任务详情
     */
    async getProjectTaskDetail(projectId: string, taskId: string): Promise<TickTickTask> {
        return this.request(`project/${projectId}/task/${taskId}`);
    }

    /**
     * 获取项目数据（包含项目信息和任务列表）
     */
    async getProjectData(projectId: string): Promise<{
        project: TickTickProject & {
            closed: boolean;
            groupId?: string;
            viewMode: string;
            kind: string;
        };
        tasks: TickTickTask[];
        columns?: {
            id: string;
            projectId: string;
            name: string;
            sortOrder: number;
        }[];
    }> {
        return this.request(`project/${projectId}/data`);
    }
}
