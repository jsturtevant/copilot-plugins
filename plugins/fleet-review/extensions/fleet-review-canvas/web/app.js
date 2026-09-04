import { buildLineDiff } from "./diff.js";

const token = new URLSearchParams(window.location.search).get("token");
const apiUrl = (path) => `${path}?token=${encodeURIComponent(token ?? "")}`;

const elements = {
    refreshProjects: document.querySelector("#refresh-projects"),
    projectSelect: document.querySelector("#project-select"),
    prSelect: document.querySelector("#pr-select"),
    runReview: document.querySelector("#run-review"),
    launchStatus: document.querySelector("#launch-status"),
    emptyState: document.querySelector("#empty-state"),
    workspace: document.querySelector("#review-workspace"),
    reviewTitle: document.querySelector("#review-title"),
    reviewStateBadge: document.querySelector("#review-state-badge"),
    reviewMeta: document.querySelector("#review-meta"),
    historySelect: document.querySelector("#history-select"),
    reconcileReview: document.querySelector("#reconcile-review"),
    openSession: document.querySelector("#open-session"),
    reviewWarning: document.querySelector("#review-warning"),
    findingSearch: document.querySelector("#finding-search"),
    severityFilter: document.querySelector("#severity-filter"),
    findingTabs: document.querySelector("#finding-tabs"),
    reviewContent: document.querySelector("#review-content"),
};

let state;
let selectedRunId = null;
let selectedTab = "report";
let busy = false;

function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(options)) {
        if (name === "className") {
            node.className = value;
        } else if (name === "text") {
            node.textContent = value;
        } else {
            node.setAttribute(name, value);
        }
    }
    for (const child of children) {
        node.append(child);
    }
    return node;
}

function setStatus(message, isError = false) {
    elements.launchStatus.textContent = message;
    elements.launchStatus.classList.toggle("error", isError);
}

async function request(path, body) {
    const response = await fetch(apiUrl(path), {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
}

function projectForSelection() {
    return state?.projects.find((project) => project.id === elements.projectSelect.value);
}

function pullRequestForSelection() {
    const project = projectForSelection();
    const number = Number(elements.prSelect.value);
    return state?.pullRequests[project?.githubRepo.toLowerCase()]?.find((pr) => pr.number === number);
}

function currentReviewKey() {
    const project = projectForSelection();
    const prNumber = Number(elements.prSelect.value);
    return project && prNumber ? `${project.githubRepo.toLowerCase()}#${prNumber}` : "";
}

function visibleHistory() {
    return state?.reviews[currentReviewKey()] ?? [];
}

function selectedRun() {
    const history = visibleHistory();
    return selectedRunId ? history.find((run) => run.runId === selectedRunId) ?? history[0] : history[0];
}

function formatTime(value) {
    if (!value) {
        return "Pending";
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(value));
}

function renderProjects() {
    const previous = elements.projectSelect.value;
    elements.projectSelect.replaceChildren(element("option", { value: "", text: "Select a repository" }));
    for (const project of state?.projects ?? []) {
        const option = element("option", {
            value: project.id,
            text: project.enabled ? project.name : `${project.name} - ${project.disabledReason}`,
        });
        option.disabled = !project.enabled;
        elements.projectSelect.append(option);
    }
    elements.projectSelect.disabled = !(state?.projects?.length > 0) || busy;
    if ([...elements.projectSelect.options].some((option) => option.value === previous && !option.disabled)) {
        elements.projectSelect.value = previous;
    }
}

function renderPullRequests() {
    const project = projectForSelection();
    const previous = elements.prSelect.value;
    const pullRequests = project ? state?.pullRequests[project.githubRepo.toLowerCase()] : undefined;
    elements.prSelect.replaceChildren();
    if (!project) {
        elements.prSelect.append(element("option", { value: "", text: "Select a repository first" }));
        elements.prSelect.disabled = true;
    } else if (!pullRequests) {
        elements.prSelect.append(element("option", { value: "", text: "Loading open pull requests..." }));
        elements.prSelect.disabled = true;
    } else if (pullRequests.length === 0) {
        elements.prSelect.append(element("option", { value: "", text: "No open pull requests" }));
        elements.prSelect.disabled = true;
    } else {
        elements.prSelect.append(element("option", { value: "", text: "Select a pull request" }));
        for (const pr of pullRequests) {
            elements.prSelect.append(
                element("option", {
                    value: String(pr.number),
                    text: `#${pr.number} ${pr.isDraft ? "[Draft] " : ""}${pr.title}`,
                }),
            );
        }
        elements.prSelect.disabled = busy;
        if ([...elements.prSelect.options].some((option) => option.value === previous)) {
            elements.prSelect.value = previous;
        }
    }
    elements.runReview.disabled = busy || !pullRequestForSelection();
}

function stateLabel(run) {
    const labels = {
        starting: "Starting",
        running: "Reviewing",
        awaiting_result: "Awaiting result",
        complete: "Complete",
        partial: "Partial",
        failed: "Failed",
    };
    return labels[run.status] ?? run.status;
}

function renderHistory(run) {
    const history = visibleHistory();
    elements.historySelect.replaceChildren(
        ...history.map((entry) =>
            element("option", {
                value: entry.runId,
                text: `${formatTime(entry.completedAt ?? entry.createdAt)} - ${stateLabel(entry)}`,
            }),
        ),
    );
    elements.historySelect.value = run.runId;
    elements.reconcileReview.disabled = !run.projectSessionId || Boolean(run.report) || busy;
    elements.openSession.disabled = !run.projectSessionId || busy;
}

function renderWarning(run) {
    const messages = [];
    if (run.stale) {
        messages.push("This review is stale because the pull request head changed. Code panes remain pinned to the reviewed commit.");
    }
    if (run.stalenessError) {
        messages.push(run.stalenessError);
    }
    if (run.status === "partial") {
        const failed = run.report?.agents.filter((agent) => agent.status !== "complete") ?? [];
        messages.push(
            `Incomplete review: ${failed.map((agent) => `${agent.name} (${agent.status.replace("_", " ")})`).join(", ")}.`,
        );
    }
    if (run.report?.counts.omitted > 0) {
        messages.push(
            `${run.report.counts.omitted} lower-priority findings were omitted from the 50-finding canvas payload.`,
        );
    }
    if (run.error) {
        messages.push(run.error);
    }
    elements.reviewWarning.hidden = messages.length === 0;
    elements.reviewWarning.textContent = messages.join(" ");
}

function appendReport(report) {
    const heading = element("div", { className: "report-heading" }, [
        element("div", {}, [
            element("h2", { text: "Review report" }),
            element("p", { text: report.summary }),
        ]),
        element("span", { className: `state-badge`, text: report.status === "partial" ? "Partial" : "Complete" }),
    ]);
    const counts = element(
        "div",
        { className: "count-strip" },
        ["critical", "high", "medium", "low"].map((severity) =>
            element("div", { className: "count-item" }, [
                element("strong", { text: String(report.counts[severity]) }),
                element("span", { text: severity }),
            ]),
        ),
    );
    const coverageBody = element(
        "tbody",
        {},
        report.agents.map((agent) =>
            element("tr", {}, [
                element("td", { text: agent.name }),
                element("td", { text: agent.model }),
                element("td", { text: agent.lens }),
                element("td", { text: agent.status.replace("_", " ") }),
                element("td", { className: "agent-error", text: agent.error || "—" }),
            ]),
        ),
    );
    const coverage = element("section", { className: "report-section" }, [
        element("h3", { text: "Review coverage" }),
        element("table", { className: "coverage-table" }, [
            element("thead", {}, [
                element("tr", {}, [
                    element("th", { text: "Agent" }),
                    element("th", { text: "Model" }),
                    element("th", { text: "Lens" }),
                    element("th", { text: "Status" }),
                    element("th", { text: "Error" }),
                ]),
            ]),
            coverageBody,
        ]),
    ]);
    const details = element("details", { className: "markdown-details" }, [
        element("summary", { text: "View Markdown artifact" }),
        element("pre", { text: report.reportMarkdown }),
    ]);
    elements.reviewContent.replaceChildren(heading, counts, coverage, details);
}

function codePane(title, code, startLine, className, badge) {
    const lines = code.split("\n");
    const pre = element(
        "pre",
        {},
        lines.map((line, index) =>
            element("span", { className: "code-line" }, [
                element("span", { className: "line-number", text: String(startLine + index) }),
                element("span", { className: "line-text", text: line || " " }),
            ]),
        ),
    );
    return element("section", { className: `code-pane ${className}` }, [
        element("header", {}, [
            element("h3", { text: title }),
            badge ?? element("span"),
        ]),
        pre,
    ]);
}

function diffPane(finding, badge) {
    const lines = buildLineDiff(finding.currentCode, finding.suggestedCode);
    const pre = element(
        "pre",
        { className: "line-diff", "aria-label": "Proposed line diff with removals and additions" },
        lines.map((line) =>
            element("span", { className: `diff-line ${line.type}` }, [
                element("span", {
                    className: "line-number old-line",
                    text: line.oldLine === null ? "" : String(finding.lineStart + line.oldLine - 1),
                }),
                element("span", {
                    className: "line-number new-line",
                    text: line.newLine === null ? "" : String(finding.lineStart + line.newLine - 1),
                }),
                element("span", {
                    className: "diff-prefix",
                    text: line.type === "added" ? "+" : line.type === "removed" ? "-" : " ",
                }),
                element("span", { className: "line-text", text: line.text || " " }),
            ]),
        ),
    );
    return element("section", { className: "code-pane proposed-diff" }, [
        element("header", {}, [element("h3", { text: "Proposed diff" }), badge]),
        pre,
    ]);
}

function appendFinding(finding) {
    const run = selectedRun();
    const openInVscode = element("button", {
        className: "button secondary vscode-button",
        type: "button",
        text: "Open annotated project",
    });
    openInVscode.disabled = run?.executionLocation !== "local";
    if (openInVscode.disabled) {
        openInVscode.title = "VS Code launch is available for local review sessions.";
        openInVscode.setAttribute(
            "aria-label",
            "Open annotated project unavailable because this review ran in the cloud",
        );
    } else {
        openInVscode.addEventListener("click", async () => {
            openInVscode.disabled = true;
            openInVscode.textContent = "Opening…";
            try {
                await request("/api/open-vscode", { runId: run.runId, findingId: finding.id });
                openInVscode.textContent = "Opened annotated project";
            } catch (error) {
                openInVscode.disabled = false;
                openInVscode.textContent = "Open annotated project";
                setStatus(error.message, true);
            }
        });
    }
    const header = element("div", { className: "finding-heading" }, [
        element("div", {}, [
            element("h2", { text: finding.title }),
            element("p", {
                className: "finding-location",
                text: `${finding.path}:${finding.lineStart}-${finding.lineEnd}`,
            }),
        ]),
        element("div", { className: "finding-heading-actions" }, [
            openInVscode,
            element("span", { className: `severity ${finding.severity}`, text: finding.severity }),
        ]),
    ]);
    const copy = element("div", { className: "finding-copy" }, [
        element("h3", { text: "Problem" }),
        element("p", { text: finding.problem }),
        element("h3", { text: "Evidence" }),
        element("p", { text: finding.evidence }),
    ]);
    const fixBadge = element("span", {
        className: `fix-kind ${finding.fixKind}`,
        text: finding.fixKind === "exact" ? "Exact replacement" : "Illustrative fix",
    });
    const comparison = element("div", { className: "code-compare" }, [
        codePane("Reviewed code", finding.currentCode, finding.lineStart, "current"),
        diffPane(finding, fixBadge),
    ]);
    const nodes = [header, copy, comparison];
    if (finding.fixKind === "illustrative") {
        nodes.push(
            element("div", { className: "judgment-note" }, [
                element("strong", { text: "Human judgment required. " }),
                document.createTextNode(finding.judgmentNotes),
            ]),
        );
    }
    elements.reviewContent.replaceChildren(...nodes);
}

function renderFindingTabs(report) {
    const query = elements.findingSearch.value.trim().toLowerCase();
    const severity = elements.severityFilter.value;
    const visible = report.findings.filter(
        (finding) =>
            (severity === "all" || finding.severity === severity) &&
            (!query ||
                `${finding.title} ${finding.path} ${finding.problem}`.toLowerCase().includes(query)),
    );
    if (selectedTab !== "report" && !visible.some((finding) => finding.id === selectedTab)) {
        selectedTab = "report";
        const reportTab = document.querySelector(".rail-tab");
        reportTab.classList.add("selected");
        reportTab.setAttribute("aria-selected", "true");
        reportTab.tabIndex = 0;
        elements.reviewContent.setAttribute("aria-labelledby", "tab-report");
        appendReport(report);
    }
    elements.findingTabs.replaceChildren();
    for (const group of ["critical", "high", "medium", "low"]) {
        const grouped = visible.filter((finding) => finding.severity === group);
        if (grouped.length === 0) {
            continue;
        }
        elements.findingTabs.append(
            element("div", { className: "severity-group", text: `${group} · ${grouped.length}` }),
        );
        for (const finding of grouped) {
            const button = element("button", {
                className: `finding-tab${selectedTab === finding.id ? " selected" : ""}`,
                type: "button",
                role: "tab",
                "aria-selected": String(selectedTab === finding.id),
                "aria-controls": "review-content",
                id: `tab-${finding.id}`,
                tabindex: selectedTab === finding.id ? "0" : "-1",
                "data-finding": finding.id,
            }, [
                element("span", { className: `severity-dot ${finding.severity}` }),
                element("span", { text: finding.title }),
            ]);
            button.addEventListener("click", () => selectTab(finding.id));
            elements.findingTabs.append(button);
        }
    }
}

function selectTab(tab) {
    selectedTab = tab;
    const reportTab = document.querySelector(".rail-tab");
    reportTab.classList.toggle("selected", tab === "report");
    reportTab.setAttribute("aria-selected", String(tab === "report"));
    reportTab.tabIndex = tab === "report" ? 0 : -1;
    elements.reviewContent.setAttribute("aria-labelledby", tab === "report" ? "tab-report" : `tab-${tab}`);
    const run = selectedRun();
    if (!run?.report) {
        return;
    }
    renderFindingTabs(run.report);
    if (tab === "report") {
        appendReport(run.report);
    } else {
        const finding = run.report.findings.find((candidate) => candidate.id === tab);
        if (finding) {
            appendFinding(finding);
        } else {
            selectedTab = "report";
            appendReport(run.report);
        }
    }
}

function renderReview() {
    const run = selectedRun();
    elements.emptyState.hidden = Boolean(run);
    elements.workspace.hidden = !run;
    if (!run) {
        return;
    }
    const pr = run.report?.pr ?? pullRequestForSelection();
    elements.reviewTitle.textContent = pr ? `#${pr.number} ${pr.title}` : `PR #${run.prNumber}`;
    elements.reviewStateBadge.textContent = stateLabel(run);
    elements.reviewMeta.textContent = `${run.repository} · ${run.executionLocation} · ${formatTime(
        run.completedAt ?? run.createdAt,
    )}`;
    renderHistory(run);
    renderWarning(run);
    if (!run.report) {
        const title = run.status === "failed" ? "Review could not start" : "The fleet is reviewing";
        const body =
            run.status === "failed"
                ? run.error
                : "Six review lenses are running in the child Copilot session. Findings will appear here when consolidation completes.";
        elements.findingTabs.replaceChildren();
        elements.reviewContent.replaceChildren(
            element("div", { className: "report-heading" }, [
                element("div", {}, [element("h2", { text: title }), element("p", { text: body })]),
            ]),
        );
        return;
    }
    selectTab(selectedTab);
}

function render() {
    renderProjects();
    renderPullRequests();
    renderReview();
}

async function withBusy(message, operation) {
    busy = true;
    setStatus(message);
    render();
    try {
        state = await operation();
        setStatus("");
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        busy = false;
        render();
    }
}

elements.refreshProjects.addEventListener("click", () =>
    withBusy("Loading configured projects through Copilot…", () => request("/api/projects", {})),
);

elements.projectSelect.addEventListener("change", () => {
    elements.prSelect.value = "";
    selectedRunId = null;
    selectedTab = "report";
    const project = projectForSelection();
    render();
    if (project) {
        void withBusy(`Loading open pull requests for ${project.githubRepo}…`, () =>
            request("/api/pull-requests", { repository: project.githubRepo }),
        );
    }
});

elements.prSelect.addEventListener("change", () => {
    selectedRunId = null;
    selectedTab = "report";
    render();
});

elements.runReview.addEventListener("click", () => {
    const project = projectForSelection();
    const pullRequest = pullRequestForSelection();
    if (!project || !pullRequest) {
        return;
    }
    const executionLocation = document.querySelector('input[name="execution"]:checked').value;
    selectedRunId = null;
    selectedTab = "report";
    void withBusy(`Creating a ${executionLocation} review session…`, () =>
        request("/api/reviews", {
            projectId: project.id,
            repository: project.githubRepo,
            prNumber: pullRequest.number,
            executionLocation,
        }),
    );
});

elements.historySelect.addEventListener("change", () => {
    selectedRunId = elements.historySelect.value;
    selectedTab = "report";
    renderReview();
});

elements.reconcileReview.addEventListener("click", () => {
    const run = selectedRun();
    if (run) {
        void withBusy("Checking the child review session…", () =>
            request("/api/reconcile", { runId: run.runId }),
        );
    }
});

elements.openSession.addEventListener("click", () => {
    const run = selectedRun();
    if (run) {
        void withBusy("Opening the child review session…", () =>
            request("/api/open-session", { runId: run.runId }).then(() => state),
        );
    }
});

document.querySelector(".rail-tab").addEventListener("click", () => selectTab("report"));
elements.findingSearch.addEventListener("input", () => {
    const run = selectedRun();
    if (run?.report) {
        renderFindingTabs(run.report);
    }
});
elements.severityFilter.addEventListener("change", () => {
    const run = selectedRun();
    if (run?.report) {
        renderFindingTabs(run.report);
    }
});

document.querySelector(".finding-rail").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || event.target.getAttribute("role") !== "tab") {
        return;
    }
    const tabs = [...document.querySelectorAll('.finding-rail [role="tab"]')];
    const current = tabs.indexOf(document.activeElement);
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = tabs[(current + delta + tabs.length) % tabs.length];
    if (next) {
        event.preventDefault();
        next.focus();
        next.click();
    }
});

if (!token) {
    setStatus("The canvas capability token is missing. Reopen Fleet Review.", true);
} else {
    try {
        state = await request("/api/state");
        render();
        const events = new EventSource(apiUrl("/events"));
        events.addEventListener("state", (event) => {
            state = JSON.parse(event.data);
            render();
        });
        events.addEventListener("error", () => {
            setStatus("Live updates disconnected. Reopen the canvas or refresh review status.", true);
        });
    } catch (error) {
        setStatus(`Fleet Review could not load: ${error.message}. Reopen the canvas to retry.`, true);
    }
}
