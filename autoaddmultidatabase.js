// 功能：自动添加文档到项目和文章数据库
// version 0.0.1

// 显示通知
function showMessage(message, isError = false, delay = 7000) {
    return fetch('/api/notification/' + (isError ? 'pushErrMsg' : 'pushMsg'), {
        method: 'POST',
        body: JSON.stringify({
            msg: message,
            timeout: delay
        })
    });
}

(async () => {
    let isProcessing = false; // 全局处理锁
    const processedNotes = new Set(); // 记录已处理的文档ID

    // 配置多个数据库的规则
    const databaseRules = [
        // {
        //     name: '项目文档数据库',
        //     dbBlockId: '20240918154915-8ktx2i4', // 数据库块ID
        //     notebookID: '20230323101042-0iji3w9', // 笔记本ID
        //     pathPattern: /^\/20240430105640-waf30sl\//i, // 文档路径匹配规则
        //     titlePattern: /^(Story|Epic|Feature)-/i // 文档标题匹配规则
        // },
        {
            name: '项目文档数据库',
            dbBlockId: '20240918154915-8ktx2i4', // 数据库块ID
            notebookID: null, // 笔记本ID
            pathPattern: null, // 文档路径匹配规则
            titlePattern: /^(Story|Epic|Feature)-/i // 文档标题匹配规则
        },
        {
            name: '文章数据库',
            dbBlockId: '20240915110837-quim9ts',
            notebookID: '20230322123651-tsuyuox',
            pathPattern: /^\/\d{14}-[a-z0-9]{7}\.sy$/, // 匹配根目录下的文档，如 /20250627214031-zmsdgbq.sy
            titlePattern: null // 不需要标题匹配
        }
        // 可以添加更多数据库规则
    ];


    // 检查文档是否符合数据库规则
    const matchDatabaseRule = (notebookId, path, title) => {
        return databaseRules.find(rule => {
            const matchNotebook = !rule.notebookID || rule.notebookID === notebookId;
            const matchPath = rule.pathPattern?.test(path) ?? true;
            const matchTitle = rule.titlePattern ? rule.titlePattern.test(title) : true;
            return matchNotebook && matchPath && matchTitle;
        });
    };


    // 1. 劫持fetch监听文档创建
    // 定义支持的API及其处理逻辑
    // 从路径中提取文档ID
    const extractDocId = (path) => {
        const match = path.match(/\d{14}-[a-z0-9]{7}(?=\.sy$)/);
        return match ? match[0] : null;
    };

    // 统一处理文档添加的延迟逻辑
    // 用于记录文档的最后处理时间
    const lastProcessTimes = new Map();
    const DEBOUNCE_DELAY = 1000; // 防抖延迟时间（毫秒）

    const scheduleDocProcess = (docId, dbBlockId = null, delay = DEBOUNCE_DELAY) => {
        const now = Date.now();
        const lastTime = lastProcessTimes.get(docId);

        // 如果该文档在短时间内已经被处理过，取消之前的定时器
        if (lastTime) {
            clearTimeout(lastTime.timerId);
        }

        // 设置新的定时器
        const timerId = setTimeout(() => {
            handleDocAdded(docId, dbBlockId);
            lastProcessTimes.delete(docId); // 处理完成后清理记录
        }, delay);

        // 记录最新的处理时间和定时器ID
        lastProcessTimes.set(docId, { timestamp: now, timerId });
    };

    const API_HANDLERS = {
        '/api/filetree/createDailyNote': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    // 检查笔记本是否匹配
                    const notebookID = '20220429170842-o80xrr2';
                    const boxid = window.siyuan.storage["local-dailynoteid"];
                    if (boxid !== notebookID) {
                        console.log('非目标笔记本，跳过');
                        return null;
                    }
                    return { dbBlockId: '20231009174308-8c1fkzi', isMultiDoc: false };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                if (!result?.data?.id) return;
                console.log(`开始处理日记 ${result.data.id}...`);
                scheduleDocProcess(result.data.id, docInfo.dbBlockId, 0);
            }
        },
        '/api/filetree/renameDoc': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    // 验证参数格式
                    if (!(params && typeof params.notebook === 'string' &&
                          typeof params.path === 'string' &&
                          typeof params.title === 'string')) {
                        return null;
                    }

                    // 匹配规则
                    const matchedRule = matchDatabaseRule(params.notebook, params.path, params.title);
                    if (!matchedRule) return null;

                    // 提取文档ID
                    const docId = extractDocId(params.path);
                    if (!docId) return null;

                    return { docId, dbBlockId: matchedRule.dbBlockId };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                console.log(`开始处理文档 ${docInfo.docId}...`);
                scheduleDocProcess(docInfo.docId, docInfo.dbBlockId, 0);
            }
        },
        '/api/filetree/createDocWithMd': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    // 验证参数格式
                    if (!(params && typeof params.path === 'string')) {
                        return null;
                    }

                    // 提取路径的最后一个部分（文档标题）
                    const pathParts = params.path.split('/');
                    const lastPart = pathParts[pathParts.length - 1];
                    
                    // 检查是否符合Epic-/Feature-/Story-规则
                    if (!/^(Epic|Feature|Story)-/.test(lastPart)) {
                        return null;
                    }

                    // 查找匹配的项目数据库规则
                    const projectRule = databaseRules.find(rule => 
                        rule.name === '项目文档数据库' && 
                        rule.titlePattern && 
                        rule.titlePattern.test(lastPart)
                    );
                    
                    if (!projectRule) return null;

                    return { dbBlockId: projectRule.dbBlockId, waitForDocId: true };
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                if (!result?.data) return;
                const docId = result.data;
                console.log(`开始处理新创建的文档 ${docId}...`);
                scheduleDocProcess(docId, docInfo.dbBlockId, 0);
            }
        },
        '/api/storage/setLocalStorageVal': {
            method: 'POST',
            validateParams: (body) => {
                try {
                    const params = JSON.parse(body);
                    // 验证参数格式
                    if (!(params &&
                          params.key === 'local-filespaths' &&
                          Array.isArray(params.val) &&
                          params.val.length <= 2)) {
                            // console.log(`跳过处理：val 数组长度为 ${params.val.length}，期望长度为 <= 2`);
                            return null;
                    }
                    // 遍历所有笔记本路径
                    for (const item of params.val) {
                        if (item.notebookId && Array.isArray(item.openPaths)) {
                            // 检查 openPaths 数组长度
                            if (item.openPaths.length !== 1) {
                                // console.log(`跳过处理：openPaths 数组长度为 ${item.openPaths.length}，期望长度为 1`);
                                continue;
                            }
                            const path = item.openPaths[0];
                            const matchedRule = matchDatabaseRule(item.notebookId, path, '');
                            const docId = extractDocId(path);
                            if (matchedRule && docId) {
                                return { dbBlockId: matchedRule.dbBlockId, docId, isMultiDoc: false };
                            }
                        }
                    }
                    return null;
                } catch (err) {
                    console.error('处理请求参数失败:', err);
                    return null;
                }
            },
            processResult: (result, docInfo) => {
                console.log(`开始处理文档 ${docInfo.docId}...`);
                scheduleDocProcess(docInfo.docId, docInfo.dbBlockId, 0);
            }
        }
    };

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url, options] = args;

        // 快速路径：只检查特定的 API
        if (!url.startsWith('/api/storage/setLocalStorageVal') &&
            !url.startsWith('/api/filetree/renameDoc') &&
            !url.startsWith('/api/filetree/createDailyNote') &&
            !url.startsWith('/api/filetree/createDocWithMd')) {
            return originalFetch.apply(this, args);
        }

        const handler = API_HANDLERS[url];
        if (handler && options?.method === handler.method) {
            // 验证参数并获取文档信息
            const docInfo = handler.validateParams(options?.body);
            if (!docInfo) {
                return originalFetch.apply(this, args);
            }

            const response = await originalFetch.apply(this, args);
            const result = await response.clone().json();

            // 异步处理数据库添加（不阻塞原始请求）
            try {
                handler.processResult(result, docInfo);
            } catch (err) {
                console.error('处理文档时出错:', err);
                showMessage(`处理文档时发生错误`, true, 5000);
            }

            return response;
        }
        return originalFetch.apply(this, args);
    };

    // 2. 实际处理函数
    async function handleDocAdded(docId, dbBlockId = null) {
        if (isProcessing || processedNotes.has(docId)) return;

        isProcessing = true;
        try {
            console.log(`开始处理文档 ${docId}...`);
            if (!dbBlockId) {
                console.log(`跳过处理文档 ${docId}：未提供数据库块ID`);
                return;
            }

            // 获取数据库信息
            const db = await getDataBySql(`SELECT * FROM blocks WHERE type='av' AND id='${dbBlockId}'`);
                if (db.length === 0) {
                    console.error(`数据库文档块 ${dbBlockId} 未找到`);
                    return;
                }

                const avID = db.map(av => getDataAvIdFromHtml(av.markdown))[0];

                // 检查是否已存在
                const isInResult = await fetchSyncPost("/api/av/getAttributeViewKeys", { id: docId });
                if (isInResult.data.some(item => item.avID === avID)) {
                    console.log(`文档已存在于数据库 ${dbBlockId} 中`);
                    return;
                }

                // 添加到数据库
                try {
                    await fetchSyncPost('/api/av/addAttributeViewBlocks', {
                        avID: avID,
                        srcs: [{ id: docId, isDetached: false }]
                    });
                    processedNotes.add(docId);
                    console.log(`成功添加文档 ${docId} 到数据库 ${dbBlockId}`);
                    // 显示成功通知
                    showMessage(`文档已成功添加到数据库`, false, 3000);
                } catch (err) {
                    console.error(`添加文档到数据库 ${dbBlockId} 失败:`, err);
                    showMessage(`添加文档到数据库失败`, true, 5000);
                }
        } catch (error) {
            console.error('处理失败:', error);
            showMessage(`处理文档时发生错误`, true, 5000);
        } finally {
            isProcessing = false;
        }
    }

    // 3. 工具函数
    function getDataAvIdFromHtml(htmlString) {
        const match = htmlString.match(/data-av-id="([^"]+)"/);        return match?.[1] || "";
    }

    async function getDataBySql(sql) {
        const result = await fetchSyncPost('/api/query/sql', { stmt: sql });
        return result.code === 0 ? result.data : [];
    }

    async function fetchSyncPost(url, data) {
        try {
            const res = await fetch(url, {
                method: "POST",
                body: JSON.stringify(data)
            });
            return await res.json();
        } catch (e) {
            console.error('API请求失败:', e);
            return { code: 1, data: null };
        }
    }
})();