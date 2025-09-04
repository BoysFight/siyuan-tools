import steveTools from "@/index";
import * as api from "@/api/api"
import { showMessage } from "siyuan";
import * as myF from "@/calendar/myF";
import { moduleInstances } from '@/index';
import { TickTickOfficialClient, TickTickTask } from './ticktick-official-client';
import { ISelectOption } from "./interface";


declare const siyuan: any;

export class M_didaSync {
    private plugin: steveTools;
    private settingdata: any;
    private officialClient?: TickTickOfficialClient;
    private mydidaSyncEnabled: boolean = false;

    constructor(plugin: steveTools) {
        this.plugin = plugin;
    }

    init = async (settingdata) => {
        this.settingdata = settingdata;
        this.mydidaSyncEnabled = this.settingdata["cal-mydida-enable"];
        if (this.mydidaSyncEnabled) {
            // 初始化官方客户端
            if (this.settingdata["cal-dida-use-official-api"]) {
                // 初始化官方客户端
                this.officialClient = new TickTickOfficialClient({
                    clientId: this.settingdata["cal-dida-official-client-id"] || "",
                    clientSecret: this.settingdata["cal-dida-official-client-secret"] || "",
                    accessToken: this.settingdata["cal-dida-official-access-token"] || undefined,
                    refreshToken: this.settingdata["cal-dida-official-refresh-token"] || undefined
                });
                // 如果设置了access token，直接使用，不走refresh流程
                if (this.settingdata["cal-dida-official-access-token"]) {
                    this.officialClient.setAccessToken(this.settingdata["cal-dida-official-access-token"]);
                }
            }
            // steveTools.outlog("滴答清单同步已启用");
        }
    }

    // 添加更新思源数据库的辅助方法
    private async updateSiyuanDatabase(event: any, blockId: string, itemID: string, rootId: string, updatedTask: any) {
        const updates = [];

        // 检查描述变化
        if (event?.描述?.content !== updatedTask.content) {
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.描述.keyID,
                itemID,
                updatedTask.content,
                "text"
            ));
        }

        // 检查开始时间变化
        if (this.formatDateToISO(event?.开始时间?.start) !== updatedTask.startDate || this.formatDateToISO(event?.开始时间?.end)!== updatedTask.dueDate) {
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.开始时间.keyID,
                itemID,
                updatedTask.startDate,
                "date",
                updatedTask.dueDate,
            ));
        }

        // 检查优先级变化
        const priorityMap = {
            0: "无",
            1: "低",
            3: "中",
            5: "高"
        };
        if (event?.优先级?.content !== priorityMap[updatedTask.priority]) {
            const selectdata: ISelectOption[] = [{ content: priorityMap[updatedTask.priority] }];
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.优先级.keyID,
                itemID,
                selectdata,
                "select"
            ));
        }

        // 检查状态变化
        const expectedStatus = updatedTask.status === 2 ? "完成" : "未完成";
        if (event?.状态?.content !== expectedStatus &&
            !(event?.状态?.content === "归档" && updatedTask.status === 2)) {
            const selectdata: ISelectOption[] = [{ content: expectedStatus }];
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.状态.keyID,
                itemID,
                selectdata,
                "select"
            ));
        }

        // 检查标签变化 - 取滴答清单标签数组的第一个值更新到思源分类
        if (updatedTask.tags?.length > 0 && event?.分类?.content !== updatedTask.tags[0]) {
            const selectdata: ISelectOption[] = [{ content: updatedTask.tags[0] }];
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.分类.keyID,
                itemID,
                selectdata,
                "select"
            ));
        }

        // 检查全天事件变化
        if (updatedTask.isAllDay !== undefined && event?.全天?.content !== updatedTask.isAllDay) {
            updates.push(api.updateAttrViewCell_pro(
                blockId,
                rootId,
                event.全天.keyID,
                itemID,
                updatedTask.isAllDay,
                "checkbox"
            ));
        }

        // 并行执行所有更新
        if (updates.length > 0) {
            await Promise.all(updates);
        }
    }

    async syncToDidaList() {
        if (!this.mydidaSyncEnabled) {
            showMessage("滴答清单同步未启用");
            return;
        }

        try {
            // 检查日历模块是否已加载
            if (!moduleInstances['M_calendar']) {
                throw new Error("日历模块未启用，请先在设置中启用日程管理功能");
            }
            // 收集需要同步的任务
            const tasksToSyncToSiyuan = new Map(); // Map<projectId, Map<taskId, {event, blockId, rootId, task, needFetch}>>
            // 用于存储需要从思源同步到滴答的任务
            const tasksToSyncToDida = new Map(); // Map<projectId, Map<blockId, {taskData, didaTaskId, currentHash}>>
            // 创建一个集合，存储所有在思源中有对应记录的任务ID
            const allSiyuanUncompletedTaskIds = new Map(); // Map<projectId, Set<taskId>>
            const allSiyuanCompletedTaskIds = new Map(); // Map<projectId, Set<taskId>> - 存储完成任务的ID
            const completedTasksBlockInfo = new Map(); // Map<taskId, {blockId, rootId, event}> - 存储完成任务的block信息
            const projectTasks = new Map(); // 缓存项目任务数据

            // 统计计数器
            let syncToDidaCount = 0;
            let syncToSiyuanCount = 0;
            let notFoundCount = 0;
            let completedTasksUpdatedCount = 0;

            // 获取昨天的日期
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);

            // 1. 获取数据库视图ID
            // 获取已有的视图ID，并进行去重
            const avIds = Array.from(new Set(await moduleInstances['M_calendar'].getAVreferenceid()));
            // 只筛选视图中名字为"所有"的进行处理，减少去重工作
            const viewIDs = await myF.getViewId(avIds,"所有");
            const viewValue = await myF.getViewValue(viewIDs);

            // 3. 遍历所有事件组
            for (const eventGroup of viewValue) {
                if (!eventGroup.data) continue;

                // 4. 遍历每个事件
                for (const event of eventGroup.data) {
                    const blockId = event?.事件?.id;
                    const itemID = event?.事件?.itemID;
                    if (!blockId) continue;

                    const startDate = this.formatDateToISO(event?.开始时间?.start);
                    if (!startDate) continue;

                    const eventStartDate = new Date(startDate);
                    if (eventStartDate <= yesterday) {
                        continue; // 跳过 startDate 小于等于昨天的任务，避免数量太多
                    }

                    const status = (event?.状态?.content === "完成" || event?.状态?.content === "归档") ? 2 : 0;
                    const isCompleted = status === 2;

                    // 计算优先级
                    let priority = 0;
                    if (event.优先级) {
                        switch (event?.优先级?.content.toLowerCase()) {
                            case 'high':
                            case '高':
                                priority = 5;
                                break;
                            case 'medium':
                            case '中':
                                priority = 3;
                                break;
                            case 'low':
                            case '低':
                                priority = 1;
                                break;
                            default:
                                priority = 0;
                        }
                    }

                    const taskData = {
                        title: event?.事件?.content || "未命名任务",
                        content: event?.描述?.content || "",
                        projectId: this.settingdata["cal-dida-default-list-id"],
                        startDate: startDate,
                        dueDate: this.formatDateToISO(event?.开始时间?.end),
                        status: status,
                        priority: priority,
                        isAllDay: event?.全天?.content || false, // 添加全天事件字段
                        tags: event?.分类?.content ? [event.分类.content] : [] // 添加标签
                    };

                    // 计算当前事件的hash值
                    const currentHash = this.calculateEventHash(taskData);

                    const attrs = await api.getBlockAttrs(blockId);
                    const previousHash = attrs["custom-event-hash"];
                    const didaTaskId = attrs["custom-dida-taskid"];

                    const projectId = this.settingdata["cal-dida-default-list-id"];

                    // 分别记录思源中处理完成和未完成的任务，供后续进一步筛选滴答中完成任务筛选使用。
                    if (isCompleted) {
                        // 完成的任务单独存储
                        if (!allSiyuanCompletedTaskIds.has(projectId)) {
                            allSiyuanCompletedTaskIds.set(projectId, new Set());
                        }
                        if (didaTaskId) {
                            allSiyuanCompletedTaskIds.get(projectId).add(didaTaskId);
                            completedTasksBlockInfo.set(didaTaskId, {
                                blockId: blockId,
                                itemID: itemID,
                                rootId: eventGroup.from.rootid,
                                event: event,
                                taskData: taskData,
                                previousHash: previousHash,  // 添加previousHash
                                currentHash: currentHash     // 添加currentHash
                            });
                        }
                        continue; // 跳过完成任务的常规同步处理
                    } else {
                        // 未完成任务的处理
                        if (!allSiyuanUncompletedTaskIds.has(projectId)) {
                            allSiyuanUncompletedTaskIds.set(projectId, new Set());
                        }
                        if (didaTaskId) {
                            allSiyuanUncompletedTaskIds.get(projectId).add(didaTaskId);
                        }
                    }

                    // 跳过已完成状态的任务，当前api不能把完成任务改为非完成，可考虑过滤
                    if (event?.状态?.content === "完成" || event?.状态?.content === "归档") {
                        continue;
                    }

                    // 如果hash值相同且已有任务ID，需要检查滴答清单的变化
                    if (didaTaskId && previousHash === currentHash) {

                        // 获取项目任务数据（如果还没有获取）
                        if (!projectTasks.has(projectId)) {
                            const projectData = await this.officialClient.getProjectData(projectId);
                            projectTasks.set(projectId, projectData.tasks);
                        }

                        // 在项目任务中查找当前任务
                        const findDidaTaskDataInDida = projectTasks.get(projectId).find(t => t.id === didaTaskId);
                        if (findDidaTaskDataInDida) {
                            // 计算滴答任务的hash
                            const didaTaskHash = this.calculateTaskHash(findDidaTaskDataInDida);

                            // 如果hash不同，说明滴答清单有更新
                            if (didaTaskHash !== previousHash) {
                                // 打印详细的差异信息
                                console.log(`发现任务差异 - 任务ID: ${didaTaskId}, 标题: "${findDidaTaskDataInDida.title || '无标题'}"`);
                                console.log(`思源笔记哈希: ${previousHash}`);
                                console.log(`滴答清单哈希: ${didaTaskHash}`);

                                // 打印具体字段差异
                                const siyuanData = {
                                    title: event?.事件?.content || "",
                                    content: event?.描述?.content || "",
                                    startDate: this.formatDateToISO(event?.开始时间?.start),
                                    dueDate: this.formatDateToISO(event?.开始时间?.end),
                                    priority: priority,
                                    status: status,
                                    tags: event?.分类?.content ? [event.分类.content] : [] // 添加标签字段
                                };

                                const didaData = {
                                    title: findDidaTaskDataInDida.title || "",
                                    content: findDidaTaskDataInDida.content || "",
                                    startDate: findDidaTaskDataInDida.startDate || null,
                                    dueDate: findDidaTaskDataInDida.dueDate || null,
                                    priority: findDidaTaskDataInDida.priority || 0,
                                    status: findDidaTaskDataInDida.status || 0,
                                    tags: findDidaTaskDataInDida.tags || [] // 添加标签字段
                                };

                                // 比较各个字段并打印差异
                                for (const key of Object.keys(siyuanData)) {
                                    if (JSON.stringify(siyuanData[key]) !== JSON.stringify(didaData[key])) {
                                        console.log(`字段 ${key} 不同:`);
                                        console.log(`  思源: ${JSON.stringify(siyuanData[key])}`);
                                        console.log(`  滴答: ${JSON.stringify(didaData[key])}`);
                                    }
                                }

                                if (!tasksToSyncToSiyuan.has(projectId)) {
                                    tasksToSyncToSiyuan.set(projectId, new Map());
                                }
                                tasksToSyncToSiyuan.get(projectId).set(didaTaskId, {
                                    event,
                                    blockId,
                                    itemID,
                                    rootId: eventGroup.from.rootid,
                                    task: findDidaTaskDataInDida // 直接保存任务数据，避免再次请求
                                });
                            }
                        } else {
                            // 如果在项目数据中找不到任务，可能是被设置为完成，需要单独获取才能确认，也可能是被删除
                            if (!tasksToSyncToSiyuan.has(projectId)) {
                                tasksToSyncToSiyuan.set(projectId, new Map());
                            }
                            tasksToSyncToSiyuan.get(projectId).set(didaTaskId, {
                                event,
                                blockId,
                                itemID,
                                rootId: eventGroup.from.rootid,
                                needFetch: true // 标记需要单独获取
                            });
                        }
                        continue;
                    }


                    if (!didaTaskId || (previousHash !== currentHash))
                    {
                        // 将任务添加到待同步滴答的队列
                        if (!tasksToSyncToDida.has(projectId)) {
                            tasksToSyncToDida.set(projectId, new Map());
                        }
                        tasksToSyncToDida.get(projectId).set(blockId, {
                            taskData,
                            didaTaskId,
                            currentHash
                        });
                    }
                }
            }

            // 批量处理需要思源同步到滴答的任务
            for (const [projectId, tasks] of tasksToSyncToDida) {
                for (const [blockId, {taskData, didaTaskId, currentHash}] of tasks) {
                    try {
                        if (!didaTaskId) {
                            // 创建新任务
                            const result = await this.createTaskUnified(taskData);

                            // 获取新任务ID（处理不同API返回格式）
                            let newTaskId;
                            if (this.settingdata["cal-dida-use-official-api"]) {
                                newTaskId = result.id;
                            }

                            if (newTaskId) {
                                // 等待属性设置完成
                                await api.setBlockAttrs(blockId, {
                                    "custom-dida-taskid": newTaskId,
                                    "custom-event-hash": currentHash
                                });
                                // 确认成功后再增加计数并打印日志
                                syncToDidaCount++;
                                console.log(`创建任务: 标题="${taskData.title}", 任务ID=${newTaskId}, 区块ID=${blockId}`);
                            }
                        } else {
                            // 更新任务
                            await this.updateTaskUnified(didaTaskId, taskData);
                            // 等待属性更新完成
                            await api.setBlockAttrs(blockId, {
                                "custom-event-hash": currentHash
                            });
                            // 确认成功后再增加计数并打印日志
                            syncToDidaCount++;
                            console.log(`更新任务: 标题="${taskData.title}", 任务ID=${didaTaskId}, 区块ID=${blockId}`);
                        }
                    } catch (error) {
                        console.error(`同步到滴答失败: 标题="${taskData.title}", ${didaTaskId ? `任务ID=${didaTaskId}, ` : ''}区块ID=${blockId}`, error);
                    }
                }
            }

            // 批量处理需要滴答同步到思源的任务
            for (const [projectId, tasks] of tasksToSyncToSiyuan) {
                for (const [taskId, {event, blockId, itemID, rootId, task, needFetch}] of tasks) {
                    let updatedTask = task;

                    // 如果需要单独获取任务数据
                    if (needFetch) {
                        updatedTask = await this.officialClient.getProjectTaskDetail(projectId, taskId);
                        if (!updatedTask) {
                            notFoundCount++;
                            console.log(`taskID错误，在滴答清单中未找到任务: 任务ID=${taskId}, 区块ID=${blockId}`);
                            continue;
                        }
                        // 获取当前思源中的hash值
                        const attrs = await api.getBlockAttrs(blockId);
                        const previousHash = attrs["custom-event-hash"];

                        // 计算新的hash值
                        const taskHash = this.calculateTaskHash(updatedTask);

                        // 只有当hash值不同时才更新
                        if (previousHash === taskHash) {
                            continue
                        }
                    }
                    // 从滴答同步到思源时
                    try {
                        // 根据滴答清单数据更新思源数据库
                        await this.updateSiyuanDatabase(event, blockId, itemID, rootId, updatedTask);

                        // 计算并更新哈希值
                        const taskHash = this.calculateTaskHash(updatedTask);
                        await api.setBlockAttrs(blockId, {
                        "custom-event-hash": taskHash
                        });

                        // 所有操作成功后再增加计数并打印日志
                        syncToSiyuanCount++;
                        console.log(`同步到思源: "needFetch:${needFetch}",标题="${updatedTask.title}", 任务ID=${taskId}, 区块ID=${blockId}, taskHash=${taskHash}`);
                    } catch (error) {
                    console.error(`同步到思源失败: 任务ID=${taskId}, 区块ID=${blockId}`, error);
                    }
                }
            }


            //处理在滴答中未完成，且在思源中没有匹配到的任务，可能是滴答中直接创建的，删掉；
            //也可能是把完成任务重新打开，这种需要把思源中的完成任务也重新标记为未完成。
            // 统计在projectTasks中没被find过的任务
            let notFoundInSiyuanCount = 0;
            let deletedTasksCount = 0;
            for (const [projectId, tasks] of projectTasks) {
                // 查找在projectTasks中但没有在思源中找到对应记录的任务
                for (const task of tasks) {
                    const siyuanUncompletedTaskIds = allSiyuanUncompletedTaskIds.get(projectId) || new Set();
                    const siyuanCompletedTaskIds = allSiyuanCompletedTaskIds.get(projectId) || new Set();

                    // 检查未完成任务是否有匹配项
                    if (siyuanUncompletedTaskIds.has(task.id) || siyuanCompletedTaskIds.has(task.id)) {
                        // 检查完成任务中是否有匹配项
                        if (siyuanCompletedTaskIds.has(task.id)) {
                            // 在完成任务中找到匹配项，更新完成的block数据
                            const completedBlockInfo = completedTasksBlockInfo.get(task.id);
                            if (completedBlockInfo) {
                                try {
                                    // 直接使用存储的哈希值
                                    const previousHash = completedBlockInfo.previousHash;
                                    const currentEventHash = completedBlockInfo.currentHash;

                                    if (previousHash === currentEventHash) {
                                        // hash值一致，说明思源数据没有变化，用滴答清单数据更新思源数据库
                                        await this.updateSiyuanDatabase(completedBlockInfo.event, completedBlockInfo.blockId, completedBlockInfo.itemID, completedBlockInfo.rootId, task);

                                        // 更新哈希值为滴答任务的hash
                                        const taskHash = this.calculateTaskHash(task);
                                        await api.setBlockAttrs(completedBlockInfo.blockId, {
                                            "custom-event-hash": taskHash
                                        });

                                        console.log(`更新完成任务(滴答→思源): 标题="${task.title}", 任务ID=${task.id}, 区块ID=${completedBlockInfo.blockId}`);
                                    } else {
                                        // hash值不一致，说明思源数据有变化，用思源数据库内容更新滴答清单
                                        // 更新滴答清单任务
                                        await this.updateTaskUnified(task.id, completedBlockInfo.taskData);

                                        // 更新hash值为当前计算的hash
                                        await api.setBlockAttrs(completedBlockInfo.blockId, {
                                            "custom-event-hash": currentEventHash
                                        });

                                        console.log(`更新完成任务(思源→滴答): 标题="${completedBlockInfo.taskData.title}", 任务ID=${task.id}, 区块ID=${completedBlockInfo.blockId}`);
                                    }

                                    completedTasksUpdatedCount++;
                                } catch (error) {
                                    console.error(`更新完成任务失败: 任务ID=${task.id}, 错误:`, error);
                                }
                            }
                        }
                    } else {
                        // 既不在未完成任务中，也不在完成任务中，删除该任务
                        console.log(`滴答清单任务未在思源中找到: 标题="${task.title}", 任务ID=${task.id}`);
                        notFoundInSiyuanCount++;

                        // 删除滴答清单中未在思源找到的任务
                        try {
                            if (this.settingdata["cal-dida-use-official-api"]) {
                                await this.officialClient.deleteTask(projectId, task.id);
                                console.log(`已删除滴答清单任务: 标题="${task.title}", 任务ID=${task.id}`);
                                deletedTasksCount++;
                            }
                        } catch (error) {
                            console.error(`删除任务失败: 任务ID=${task.id}, 错误:`, error);
                        }
                    }
                }
            }

            // 显示同步结果消息
            console.log(`========== 滴答清单同步完成 ==========`);
            console.log(`同步到滴答清单: ${syncToDidaCount}个任务`);
            console.log(`同步到思源: ${syncToSiyuanCount}个任务`);
            console.log(`更新完成任务: ${completedTasksUpdatedCount}个任务`);
            console.log(`未找到匹配项: ${notFoundCount}个任务`);
            console.log(`滴答清单中未在思源找到: ${notFoundInSiyuanCount}个任务`);
            if (deletedTasksCount > 0) {
                console.log(`已删除滴答清单任务: ${deletedTasksCount}个任务`);
            }
            console.log(`======================================`);

            // 构建动态消息，只显示count大于0的项目
            const messageParts = [];
            if (syncToDidaCount > 0) {
                messageParts.push(`${syncToDidaCount}个任务同步到滴答清单`);
            }
            if (syncToSiyuanCount > 0) {
                messageParts.push(`${syncToSiyuanCount}个任务同步到思源`);
            }
            if (completedTasksUpdatedCount > 0) {
                messageParts.push(`${completedTasksUpdatedCount}个完成任务已更新`);
            }
            if (notFoundCount > 0) {
                messageParts.push(`未找到匹配项: ${notFoundCount}个`);
            }
            if (notFoundInSiyuanCount > 0) {
                messageParts.push(`滴答清单中有但未在思源找到: ${notFoundInSiyuanCount}个`);
            }
            if (deletedTasksCount > 0) {
                messageParts.push(`${deletedTasksCount}个任务已从滴答清单删除`);
            }

            const message = messageParts.length > 0
                ? `滴答同步完成: ${messageParts.join(', ')}`
                : '滴答同步完成: 无变化';

            showMessage(message);
            api.showStatusMessage(message, 10000, "mydida");

        } catch (error) {
            console.error("滴答清单同步失败:", error);
            showMessage(`滴答清单同步失败: ${error.message}`, -1, "error");
        }
    }

    // 新增：手动触发滴答清单同步
    async manualDidaSync() {
        if (!this.mydidaSyncEnabled) {
            showMessage("滴答清单同步未启用");
            return;
        }
        await this.syncToDidaList();
    }

    async getProjectData(projectId: string) {
        if (!this.mydidaSyncEnabled) {
            showMessage("滴答清单同步未启用");
            return;
        }
        return await this.officialClient.getProjectData(projectId);
    }

    // 添加日期格式化方法
    private formatDateToISO(dateInput: any): string | undefined {
        if (!dateInput) return undefined;

        let date: Date;

        // 处理不同类型的日期输入
        if (dateInput instanceof Date) {
            date = dateInput;
        } else if (typeof dateInput === 'string') {
            date = new Date(dateInput);
        } else if (typeof dateInput === 'number') {
            date = new Date(dateInput);
        } else {
            return undefined;
        }

        // 检查日期是否有效
        if (isNaN(date.getTime())) {
            return undefined;
        }

        // 转换为 ISO 格式并替换时区为 +0000
        return date.toISOString().replace('Z', '+0000');
    }

    // 添加计算事件hash值的方法
    // 创建一个通用的哈希计算函数
    private calculateHash(data: {
        title: string,
        content: string,
        startDate: string | null,
        dueDate: string | null,
        priority: number,
        status: number,
        tags?: string[], // 添加标签字段
        isAllDay?: boolean // 添加全天事件字段
    }): string {
        // 标准化数据，确保空值处理一致
        const hashData = {
            title: data.title || "",
            content: data.content || "",
            startDate: data.startDate || null,
            dueDate: data.dueDate || null,
            priority: typeof data.priority === 'number' ? data.priority : 0,
            status: data.status || 0,
            tags: data.tags || [], // 添加标签处理
            isAllDay: data.isAllDay // 添加全天事件字段
        };

        const str = JSON.stringify(hashData);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    // 修改现有的事件哈希计算方法
    private calculateEventHash(task: {
        title: string,
        content: string,
        startDate: string | null,
        dueDate: string | null,
        priority: number,
        status: number,
        tags?: string[], // 添加标签字段
        isAllDay?: boolean // 添加全天事件字段
    }): string {
        return this.calculateHash({
            title: task.title || "",
            content: task.content || "",
            startDate: task.startDate || null,
            dueDate: task.dueDate || null,
            priority: task.priority || 0,
            status: task.status || 0,
            tags: task.tags || [], // 添加标签
            isAllDay: task.isAllDay // 添加全天事件字段
        });
    }

    // 修改现有的任务哈希计算方法
    private calculateTaskHash(task: any): string {
        return this.calculateHash({
            title: task.title || "",
            content: task.content || "",
            startDate: task.startDate || null,
            dueDate: task.dueDate || null,
            priority: task.priority || 0,
            status: task.status || 0,
            tags: task.tags || [], // 添加标签
            isAllDay: task.isAllDay // 添加全天事件字段
        });
    }

    // 统一的任务创建接口
    private async createTaskUnified(taskData: any): Promise<any> {
        if (this.settingdata["cal-dida-use-official-api"]) {
            if (!this.officialClient) {
                // 初始化官方客户端
                this.officialClient = new TickTickOfficialClient({
                    clientId: this.settingdata["cal-dida-official-client-id"] || "",
                    clientSecret: this.settingdata["cal-dida-official-client-secret"] || "",
                    accessToken: this.settingdata["cal-dida-official-access-token"] || undefined,
                    refreshToken: this.settingdata["cal-dida-official-refresh-token"] || undefined
                });
                // 如果设置了access token，直接使用，不走refresh流程
                if (this.settingdata["cal-dida-official-access-token"]) {
                    this.officialClient.setAccessToken(this.settingdata["cal-dida-official-access-token"]);
                }
            }
            const officialTask: TickTickTask = {
                title: taskData.title,
                content: taskData.content,
                projectId: taskData.projectId,
                startDate: taskData.startDate,
                dueDate: taskData.dueDate,
                priority: taskData.priority,
                status: taskData.status,
                tags: taskData.tags, // 添加标签字段
                isAllDay: taskData.isAllDay // 添加全天事件字段
            };
            return await this.officialClient.createTask(officialTask);
        }
    }

    // 统一的任务更新接口
    private async updateTaskUnified(taskId: string, taskData: any): Promise<any> {
        if (this.settingdata["cal-dida-use-official-api"]) {
            if (!this.officialClient) {
                // 初始化官方客户端
                this.officialClient = new TickTickOfficialClient({
                    clientId: this.settingdata["cal-dida-official-client-id"] || "",
                    clientSecret: this.settingdata["cal-dida-official-client-secret"] || "",
                    accessToken: this.settingdata["cal-dida-official-access-token"] || undefined,
                    refreshToken: this.settingdata["cal-dida-official-refresh-token"] || undefined
                });
                // 如果设置了access token，直接使用，不走refresh流程
                if (this.settingdata["cal-dida-official-access-token"]) {
                    this.officialClient.setAccessToken(this.settingdata["cal-dida-official-access-token"]);
                }
            }
            // 使用官方API
            const officialTask: Partial<TickTickTask> = {
                title: taskData.title,
                content: taskData.content,
                projectId: taskData.projectId,
                startDate: taskData.startDate,
                dueDate: taskData.dueDate,
                priority: taskData.priority,
                status: taskData.status,
                tags: taskData.tags, // 添加标签字段
                isAllDay: taskData.isAllDay // 添加全天事件字段
            };
            return await this.officialClient.updateTask(taskId, officialTask);
        }
    }
}