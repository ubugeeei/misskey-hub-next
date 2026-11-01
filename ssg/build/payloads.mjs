export function assignLanes(pages, count) {
	const groups = new Map(),
		lanes = Array.from({ length: count }, () => []);
	pages.forEach((page, index) => {
		// Both locales share FAQ objects whose cached HTML is observed by later pages.
		const locale = page.locale === "ja-ks" ? "ja" : page.locale;
		const group = groups.get(locale) ?? [];
		group.push(index);
		groups.set(locale, group);
	});
	for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
		const lane = lanes.reduce((left, right) => (left.length <= right.length ? left : right));
		lane.push(...group);
	}
	// Different locale groups can share surrounding/related objects. If groups
	// share a worker, retain the original page order before those objects mutate.
	return lanes.map((lane) => lane.sort((left, right) => left - right));
}

export function preparePayloads(pages) {
	return pages.map((page) => {
		const inline = {};
		const visit = (value) => {
			if (typeof value === "string" && page.inlineMarkdown?.[value])
				inline[value] = page.inlineMarkdown[value];
			else if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === "object") Object.values(value).forEach(visit);
		};
		visit(page.document);
		return { ...page, inlineMarkdown: inline };
	});
}
