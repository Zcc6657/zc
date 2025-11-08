from flask import Flask, render_template
import json
import os
from datetime import datetime

app = Flask(__name__)

# 数据存储文件
DATA_FILE = "duty_data.json"

# 三组默认成员配置
INITIAL_DATA = {
    "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M"),
    "groups": [
        {
            "name": "第一组",
            "members": ["张三", "李四"],
            "days": ["周一", "周二"]
        },
        {
            "name": "第二组",
            "members": ["王五", "赵六"],
            "days": ["周三", "周四"]
        },
        {
            "name": "第三组",
            "members": ["钱七", "孙八"],
            "days": ["周五", "周六", "周日"]
        }
    ]
}


def load_data():
    """加载数据文件，不存在则创建初始数据"""
    if not os.path.exists(DATA_FILE):
        save_data(INITIAL_DATA)
        return INITIAL_DATA.copy()

    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        save_data(INITIAL_DATA)
        return INITIAL_DATA.copy()


def save_data(data):
    """保存数据到文件"""
    data['last_updated'] = datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_current_group_index():
    """根据当前日期计算应该显示哪一组"""
    # 获取当前是星期几（0-6，0是周一）
    weekday = datetime.now().weekday()
    # 计算当前是第几轮循环（每周一轮）
    total_days = (datetime.now() - datetime(2025, 11, 8)).days
    week_count = total_days // 7
    # 3组循环，所以取模
    return (week_count % 3)


@app.route('/')
def index():
    data = load_data()
    current_index = get_current_group_index()
    next_index = (current_index + 1) % 3

    # 获取当前和下一组信息
    current_group = data['groups'][current_index]
    next_group = data['groups'][next_index]

    # 生成一周的值日表
    week_days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    schedule = []

    for i, day in enumerate(week_days):
        # 每天一组，按顺序循环
        group_index = (current_index + i) % 3
        schedule.append({
            "day": day,
            "group": data['groups'][group_index]['name']
        })

    return render_template('index.html',
                           current_group=current_group['name'],
                           next_group=next_group['name'],
                           groups=data['groups'],
                           schedule=schedule,
                           last_updated=data['last_updated'])


if __name__ == '__main__':
    app.run(debug=True)
