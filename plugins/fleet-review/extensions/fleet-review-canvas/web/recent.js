export function recentReviewRuns(reviews, limit = 8) {
    return Object.values(reviews ?? {})
        .flat()
        .sort((left, right) => {
            const leftTime = Date.parse(left.completedAt ?? left.createdAt ?? 0);
            const rightTime = Date.parse(right.completedAt ?? right.createdAt ?? 0);
            return rightTime - leftTime;
        })
        .slice(0, limit);
}
