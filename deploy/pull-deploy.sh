#!/usr/bin/env bash
# Pull-деплой: если в origin/main появился новый коммит с зелёным CI — обновляемся.
# Запускается таймером rpg-deploy.timer; вручную: systemctl start rpg-deploy
set -euo pipefail

REPO_DIR=/root/rpgm
BRANCH=main
GITHUB_REPO=Raven632/rpg-web-library
CI_WORKFLOW=.github/workflows/ci.yml

main() {
    cd "$REPO_DIR"

    # 1. Есть незакоммиченные правки — значит, кто-то работает прямо на сервере. Не мешаем.
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        echo "Есть незакоммиченные изменения, деплой пропущен"
        return 0
    fi

    # 2. Что нового на GitHub?
    git fetch --quiet origin "$BRANCH"
    local local_sha remote_sha
    local_sha=$(git rev-parse HEAD)
    remote_sha=$(git rev-parse "origin/$BRANCH")

    if [ "$local_sha" = "$remote_sha" ]; then
        return 0
    fi

    # 3. Обновляемся только "перемоткой вперёд": локальных коммитов поверх origin быть не должно
    if ! git merge-base --is-ancestor HEAD "$remote_sha"; then
        echo "Локальная ветка впереди origin или разошлась с ним, деплой пропущен"
        return 0
    fi

    # 4. CI должен быть зелёным именно для этого коммита
    local ci
    ci=$(curl -fsS "https://api.github.com/repos/$GITHUB_REPO/actions/runs?head_sha=$remote_sha&event=push" \
        | jq -r --arg wf "$CI_WORKFLOW" '[.workflow_runs[] | select(.path == $wf)][0].conclusion // "pending"')
    if [ "$ci" != "success" ]; then
        echo "CI для ${remote_sha:0:7}: $ci, ждём"
        return 0
    fi

    # 5. Обновляемся ровно до проверенного коммита и пересобираем контейнеры
    echo "Деплой ${local_sha:0:7} -> ${remote_sha:0:7}"
    git merge --ff-only --quiet "$remote_sha"
    docker compose up -d --build --remove-orphans
    echo "Готово"
}

main "$@"; exit