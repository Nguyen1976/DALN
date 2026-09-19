import { Clock, Eye, Sparkles, Users } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsCard, SettingsSection } from "./parts";

/**
 * None of these can be changed yet. The switches show how things work today
 * (everything visible), marked "Sắp có", rather than pretending to be off.
 */
export default function PrivacySettings() {
  return (
    <>
      <SettingsSection title="Hồ sơ">
        <SettingsCard>
          <SettingRow
            icon={Eye}
            title="Ai xem được hồ sơ"
            description="Hiện tại: mọi người dùng DALN Chat."
            soon
          />
          <SettingRow
            icon={Sparkles}
            title="Xuất hiện trong gợi ý kết bạn"
            description="Cho phép người có bạn chung hoặc cùng sở thích thấy bạn."
            soon
          >
            <Switch
              checked
              disabled
              aria-label="Xuất hiện trong gợi ý kết bạn"
            />
          </SettingRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Trạng thái hoạt động" step={1}>
        <SettingsCard>
          <SettingRow
            icon={Users}
            title="Trạng thái trực tuyến"
            description="Hiện chấm xanh cạnh ảnh đại diện khi bạn đang mở ứng dụng."
            soon
          >
            <Switch checked disabled aria-label="Trạng thái trực tuyến" />
          </SettingRow>
          <SettingRow
            icon={Clock}
            title="Lần hoạt động gần nhất"
            description="Hiện “hoạt động 5 phút trước” khi bạn vừa rời đi."
            soon
          >
            <Switch checked disabled aria-label="Lần hoạt động gần nhất" />
          </SettingRow>
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
