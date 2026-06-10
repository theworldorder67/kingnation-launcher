package fr.kingnation.menu;

import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.DisconnectedScreen;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.ProgressScreen;
import net.minecraft.client.gui.screens.ReceivingLevelScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.options.AccessibilityOptionsScreen;
import net.minecraft.client.gui.screens.options.ChatOptionsScreen;
import net.minecraft.client.gui.screens.options.LanguageSelectScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.options.SoundOptionsScreen;
import net.minecraft.client.gui.screens.options.VideoSettingsScreen;
import net.minecraft.client.gui.screens.options.controls.ControlsScreen;
import net.minecraft.client.gui.screens.packs.PackSelectionScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

@Mod(value = KingNationMenuMod.MOD_ID, dist = Dist.CLIENT)
public final class KingNationMenuMod {
  public static final String MOD_ID = "kingnationmenu";
  private static final String WINDOW_TITLE = "KINGNATION";
  private static final String DEFAULT_SERVER = "play.kingnation.fr:25565";
  private static final ResourceLocation BACKGROUND = ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/background.png");
  private static final ResourceLocation TITLE = ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/title.png");
  private static final ResourceLocation OPTIONS_TITLE = ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/options_title.png");
  private static final ResourceLocation LOADING_TITLE = ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/loading.png");
  private static final int BACKGROUND_WIDTH = 1672;
  private static final int BACKGROUND_HEIGHT = 941;
  private static final int TITLE_WIDTH = 1024;
  private static final int TITLE_HEIGHT = 256;
  private static final int OPTIONS_TITLE_WIDTH = 1024;
  private static final int OPTIONS_TITLE_HEIGHT = 160;
  private static final int LOADING_TITLE_WIDTH = 1024;
  private static final int LOADING_TITLE_HEIGHT = 128;
  private static final int AMBIENT_PARTICLE_COUNT = 24;

  public KingNationMenuMod() {
    NeoForge.EVENT_BUS.register(this);
  }

  @SubscribeEvent
  public void onScreenOpening(ScreenEvent.Opening event) {
    applyWindowTitle();
    Screen newScreen = event.getNewScreen();

    if (newScreen instanceof TitleScreen && !(newScreen instanceof KingNationTitleScreen)) {
      event.setNewScreen(new KingNationTitleScreen());
      return;
    }

    if (shouldHideDisconnectDetails(newScreen)) {
      event.setNewScreen(new KingNationConnectionFailedScreen());
      return;
    }

    if (newScreen instanceof PauseScreen) {
      event.setNewScreen(new KingNationPauseScreen());
      return;
    }

    if (newScreen instanceof OptionsScreen) {
      event.setNewScreen(new KingNationOptionsScreen(event.getCurrentScreen()));
    }
  }

  @SubscribeEvent
  public void onClientTick(ClientTickEvent.Post event) {
    applyWindowTitle();
  }

  @SubscribeEvent
  public void onBackgroundRendered(ScreenEvent.BackgroundRendered event) {
    Screen screen = event.getScreen();
    if (isDistantHorizonsScreen(screen)) {
      if (shouldRenderMenuWallpaper(screen)) {
        renderDistantHorizonsBackground(event.getGuiGraphics(), screen.width, screen.height);
      }
      return;
    }

    if (!shouldRenderMenuWallpaper(screen)) {
      return;
    }

    renderKingNationBackground(event.getGuiGraphics(), screen.width, screen.height);
  }

  @SubscribeEvent
  public void onScreenRenderPre(ScreenEvent.Render.Pre event) {
    Screen screen = event.getScreen();
    if (!shouldRenderCustomLoadingScreen(screen)) {
      return;
    }

    renderLoadingScreen(event.getGuiGraphics(), screen, event.getPartialTick());
    event.setCanceled(true);
  }

  private static void applyWindowTitle() {
    Minecraft client = Minecraft.getInstance();
    if (client != null && client.getWindow() != null) {
      client.getWindow().setTitle(WINDOW_TITLE);
    }
  }

  private static void renderKingNationBackground(GuiGraphics graphics, int width, int height) {
    graphics.blit(BACKGROUND, 0, 0, width, height, 0.0F, 0.0F, BACKGROUND_WIDTH, BACKGROUND_HEIGHT, BACKGROUND_WIDTH, BACKGROUND_HEIGHT);
    graphics.fill(0, 0, width, height, 0xAA000000);
    graphics.fillGradient(0, 0, width, height, 0x66030810, 0x99100008);
    renderAmbientMotion(graphics, width, height, false);
  }

  private static void renderPauseGlassBackground(GuiGraphics graphics, int width, int height) {
    graphics.fill(0, 0, width, height, 0x64000000);
    graphics.fillGradient(0, 0, width, height, 0x3303060C, 0x88000000);
    graphics.fill(0, 0, width, Math.max(24, height / 8), 0x26000000);
    renderAmbientMotion(graphics, width, height, true);
  }

  private static void renderDistantHorizonsBackground(GuiGraphics graphics, int width, int height) {
    renderKingNationBackground(graphics, width, height);
    graphics.fill(0, 0, width, height, 0x22000000);
  }

  private static void renderAmbientMotion(GuiGraphics graphics, int width, int height, boolean quiet) {
    if (width <= 0 || height <= 0) {
      return;
    }

    double seconds = System.nanoTime() / 1_000_000_000.0D;
    int particleBaseAlpha = quiet ? 8 : 12;

    for (int i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
      int seed = i * 73 + 17;
      int x = positiveModulo(seed * 41, width + 36) - 18;
      int y = positiveModulo(seed * 29, height + 42) - 21;
      double pulse = (Math.sin(seconds * (0.65D + (i % 5) * 0.11D) + seed * 0.27D) + 1.0D) * 0.5D;
      int alpha = particleBaseAlpha + (int) (pulse * (quiet ? 8 : 12));
      boolean gold = (i % 7) == 0;
      int red = gold ? 255 : 255;
      int green = gold ? 197 : 38;
      int blue = gold ? 78 : 60;

      graphics.fill(x, y, x + 1, y + 1, argb(alpha, red, green, blue));
    }

    int vignetteAlpha = quiet ? 26 : 34;
    graphics.fillGradient(0, 0, width, Math.max(36, height / 5), argb(vignetteAlpha, 0, 0, 0), 0x00000000);
    graphics.fillGradient(0, Math.max(0, height - height / 4), width, height, 0x00000000, argb(vignetteAlpha + 14, 0, 0, 0));
  }

  private static void renderLoadingScreen(GuiGraphics graphics, Screen screen, float partialTick) {
    int width = screen.width;
    int height = screen.height;

    graphics.fill(0, 0, width, height, 0xFF202226);
    graphics.fillGradient(0, 0, width, height, 0xFF25272B, 0xFF0B0C10);
    graphics.fillGradient(0, 0, width, Math.max(48, height / 3), 0x662D3036, 0x002D3036);

    renderTitle(graphics, width, height);

    int loadingWidth = Math.min(width - 60, Math.max(220, width / 3));
    int loadingHeight = Math.max(28, loadingWidth * LOADING_TITLE_HEIGHT / LOADING_TITLE_WIDTH);
    int loadingX = (width - loadingWidth) / 2;
    int titleBottom = titleY(height) + titleHeight(width);
    int loadingY = Math.min(height - loadingHeight - 44, Math.max(titleBottom + 28, height * 3 / 5));

    RenderSystem.enableBlend();
    RenderSystem.defaultBlendFunc();
    RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
    graphics.blit(LOADING_TITLE, loadingX, loadingY, loadingWidth, loadingHeight, 0.0F, 0.0F, LOADING_TITLE_WIDTH, LOADING_TITLE_HEIGHT, LOADING_TITLE_WIDTH, LOADING_TITLE_HEIGHT);
    RenderSystem.disableBlend();

    int barWidth = Math.min(width - 80, 360);
    int barHeight = 5;
    int barX = (width - barWidth) / 2;
    int barY = loadingY + loadingHeight + 18;
    int progress = loadingProgress(screen);
    int fillWidth = progress >= 0
      ? barWidth * Math.min(100, Math.max(0, progress)) / 100
      : animatedLoadingWidth(barWidth, partialTick);

    graphics.fill(barX - 1, barY - 1, barX + barWidth + 1, barY + barHeight + 1, 0x88FFFFFF);
    graphics.fill(barX, barY, barX + barWidth, barY + barHeight, 0x33000000);
    graphics.fill(barX, barY, barX + fillWidth, barY + barHeight, 0xFFFFFFFF);
  }

  private static boolean shouldRenderMenuWallpaper(Screen screen) {
    if (screen == null
      || screen instanceof KingNationTitleScreen
      || screen instanceof KingNationOptionsScreen
      || screen instanceof KingNationGraphicsScreen
      || screen instanceof KingNationPauseScreen
      || screen instanceof TitleScreen
      || shouldRenderCustomLoadingScreen(screen)) {
      return false;
    }

    Minecraft client = Minecraft.getInstance();
    if (client != null && client.level != null) {
      return false;
    }

    Package screenPackage = screen.getClass().getPackage();
    String packageName = screenPackage == null ? "" : screenPackage.getName();
    return !packageName.startsWith("net.minecraft.client.gui.screens.inventory");
  }

  private static boolean isDistantHorizonsScreen(Screen screen) {
    return screen != null && screen.getClass().getName().startsWith("com.seibel.distanthorizons.");
  }

  private static boolean shouldHideDisconnectDetails(Screen screen) {
    if (screen == null || screen instanceof KingNationConnectionFailedScreen) {
      return false;
    }

    String className = screen.getClass().getName();
    if (screen instanceof DisconnectedScreen || className.equals("net.neoforged.neoforge.client.gui.ModMismatchDisconnectedScreen")) {
      return true;
    }

    String title = screen.getTitle().getString().toLowerCase();
    return className.toLowerCase().contains("disconnect") || title.contains("connection lost") || title.contains("disconnected");
  }

  private static boolean shouldRenderCustomLoadingScreen(Screen screen) {
    if (screen == null) {
      return false;
    }

    if (screen instanceof ReceivingLevelScreen || screen instanceof ProgressScreen) {
      return true;
    }

    if (screen instanceof GenericMessageScreen) {
      String title = screen.getTitle().getString().toLowerCase();
      return title.contains("saving")
        || title.contains("sauvegarde")
        || title.contains("loading")
        || title.contains("chargement")
        || title.contains("preparing")
        || title.contains("terrain")
        || title.contains("world");
    }

    return false;
  }

  private static boolean hasDistantHorizonsConfigScreen() {
    try {
      Class.forName("com.seibel.distanthorizons.common.wrappers.gui.GetConfigScreen_neoforge");
      return true;
    } catch (ClassNotFoundException ignored) {
      return false;
    }
  }

  private static void openDistantHorizonsConfig(Screen parent) {
    try {
      Class<?> screenFactory = Class.forName("com.seibel.distanthorizons.common.wrappers.gui.GetConfigScreen_neoforge");
      Object screen = screenFactory.getMethod("getScreen", Screen.class).invoke(null, parent);
      if (screen instanceof Screen dhScreen) {
        Minecraft.getInstance().setScreen(dhScreen);
      }
    } catch (ReflectiveOperationException ignored) {
      Minecraft.getInstance().setScreen(parent);
    }
  }

  private static boolean hasPhysicsModConfigScreen() {
    try {
      Class.forName("net.diebuddies.physics.settings.PhysicsSettingsScreen");
      return true;
    } catch (ClassNotFoundException ignored) {
      return false;
    }
  }

  private static void openPhysicsModConfig(Screen parent) {
    try {
      Class<?> screenClass = Class.forName("net.diebuddies.physics.settings.PhysicsSettingsScreen");
      Object screen = screenClass.getConstructor(Screen.class).newInstance(parent);
      if (screen instanceof Screen pScreen) {
        Minecraft.getInstance().setScreen(pScreen);
      }
    } catch (ReflectiveOperationException ignored) {
      Minecraft.getInstance().setScreen(parent);
    }
  }

  private static boolean hasIrisShaderPackScreen() {
    try {
      Class.forName("net.irisshaders.iris.gui.screen.ShaderPackScreen");
      return true;
    } catch (ClassNotFoundException ignored) {
      return false;
    }
  }

  private static void openIrisShaderPackScreen(Screen parent) {
    try {
      Class<?> shaderPackScreen = Class.forName("net.irisshaders.iris.gui.screen.ShaderPackScreen");
      Object screen = shaderPackScreen.getConstructor(Screen.class).newInstance(parent);
      if (screen instanceof Screen irisScreen) {
        Minecraft.getInstance().setScreen(irisScreen);
      }
    } catch (ReflectiveOperationException ignored) {
      Minecraft.getInstance().setScreen(parent);
    }
  }

  private static void openResourcePackScreen(Screen parent) {
    Minecraft client = Minecraft.getInstance();
    client.setScreen(new PackSelectionScreen(
      client.getResourcePackRepository(),
      repository -> {
        client.options.updateResourcePacks(repository);
        client.setScreen(parent);
      },
      client.getResourcePackDirectory(),
      Component.translatable("resourcePack.title")
    ));
  }

  private static int loadingProgress(Screen screen) {
    if (!(screen instanceof ProgressScreen)) {
      return -1;
    }

    try {
      java.lang.reflect.Field field = ProgressScreen.class.getDeclaredField("progress");
      field.setAccessible(true);
      return field.getInt(screen);
    } catch (ReflectiveOperationException ignored) {
      return -1;
    }
  }

  private static int animatedLoadingWidth(int barWidth, float partialTick) {
    long tick = (System.currentTimeMillis() / 18L) % 140L;
    int minimum = Math.max(24, barWidth / 7);
    int maximum = Math.max(minimum, barWidth - 10);
    return minimum + (int) ((maximum - minimum) * tick / 139.0F);
  }

  private static void connectToServer(Screen source) {
    Minecraft client = Minecraft.getInstance();
    String address = serverAddress();
    ServerData data = new ServerData("KingNation", address, ServerData.Type.OTHER);
    ConnectScreen.startConnecting(source, client, ServerAddress.parseString(address), data, false, null);
  }

  private static String serverAddress() {
    String value = System.getProperty("kingnation.serverIp", DEFAULT_SERVER).trim();
    return value.isEmpty() ? DEFAULT_SERVER : value;
  }

  private static void renderTitle(GuiGraphics graphics, int screenWidth, int screenHeight) {
    int titleWidth = titleWidth(screenWidth);
    int titleHeight = titleHeight(screenWidth);
    int x = (screenWidth - titleWidth) / 2;
    int y = titleY(screenHeight);

    RenderSystem.enableBlend();
    RenderSystem.defaultBlendFunc();
    RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
    graphics.blit(TITLE, x, y, titleWidth, titleHeight, 0.0F, 0.0F, TITLE_WIDTH, TITLE_HEIGHT, TITLE_WIDTH, TITLE_HEIGHT);
    RenderSystem.disableBlend();

    graphics.fill(x + titleWidth / 5, y + titleHeight + 8, x + titleWidth * 4 / 5, y + titleHeight + 9, 0xFFFF263C);
  }

  private static void renderPauseTitle(GuiGraphics graphics, int screenWidth, int screenHeight) {
    int titleWidth = Math.min(screenWidth - 80, 270);
    titleWidth = Math.max(160, titleWidth);
    int titleHeight = Math.max(40, titleWidth * TITLE_HEIGHT / TITLE_WIDTH);
    int x = (screenWidth - titleWidth) / 2;
    int y = pauseTitleY(screenHeight);

    RenderSystem.enableBlend();
    RenderSystem.defaultBlendFunc();
    RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
    graphics.blit(TITLE, x, y, titleWidth, titleHeight, 0.0F, 0.0F, TITLE_WIDTH, TITLE_HEIGHT, TITLE_WIDTH, TITLE_HEIGHT);
    RenderSystem.disableBlend();

    graphics.fill(x + titleWidth / 4, y + titleHeight + 5, x + titleWidth * 3 / 4, y + titleHeight + 6, 0xCCFF263C);
  }

  private static void renderOptionsHeader(GuiGraphics graphics, int screenWidth, int screenHeight) {
    int centerX = screenWidth / 2;
    int logoWidth = Math.min(screenWidth - 56, 270);
    int logoHeight = Math.max(30, logoWidth * OPTIONS_TITLE_HEIGHT / OPTIONS_TITLE_WIDTH);
    int x = centerX - logoWidth / 2;
    int y = Math.max(12, screenHeight / 22);

    RenderSystem.enableBlend();
    RenderSystem.defaultBlendFunc();
    RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
    graphics.blit(OPTIONS_TITLE, x, y, logoWidth, logoHeight, 0.0F, 0.0F, OPTIONS_TITLE_WIDTH, OPTIONS_TITLE_HEIGHT, OPTIONS_TITLE_WIDTH, OPTIONS_TITLE_HEIGHT);
    RenderSystem.disableBlend();

    graphics.fill(centerX - logoWidth / 4, y + logoHeight + 8, centerX + logoWidth / 4, y + logoHeight + 9, 0xFFFF263C);
  }

  private static int pausePanelWidth(int screenWidth) {
    return Math.min(screenWidth - 80, Math.max(210, screenWidth / 4));
  }

  private static int pausePanelHeight(int screenHeight) {
    return Math.min(screenHeight - 90, 116);
  }

  private static int pauseTitleY(int screenHeight) {
    return Math.max(10, screenHeight / 18);
  }

  private static int pausePanelY(int screenWidth, int screenHeight, int panelHeight) {
    int titleHeight = Math.max(40, Math.max(160, Math.min(screenWidth - 80, 270)) * TITLE_HEIGHT / TITLE_WIDTH);
    int titleBottom = pauseTitleY(screenHeight) + titleHeight + 14;
    int centered = (screenHeight - panelHeight) / 2 + 26;
    int lowerLimit = Math.max(12, screenHeight - panelHeight - 18);
    return Math.min(lowerLimit, Math.max(titleBottom, centered));
  }

  private static int titleWidth(int screenWidth) {
    int maxWidth = Math.min(screenWidth - 32, 460);
    return Math.max(250, Math.min(maxWidth, screenWidth * 3 / 4));
  }

  private static int titleHeight(int screenWidth) {
    return Math.max(42, titleWidth(screenWidth) * TITLE_HEIGHT / TITLE_WIDTH);
  }

  private static int titleY(int screenHeight) {
    return Math.max(10, screenHeight / 16);
  }

  private static int argb(int alpha, int red, int green, int blue) {
    int a = Math.max(0, Math.min(255, alpha));
    return (a << 24) | (red << 16) | (green << 8) | blue;
  }

  private static int positiveModulo(int value, int modulo) {
    if (modulo <= 0) {
      return 0;
    }

    int result = value % modulo;
    return result < 0 ? result + modulo : result;
  }

  private static int triangleWave(int value, int period) {
    int half = Math.max(1, period / 2);
    int position = positiveModulo(value, Math.max(2, period));
    return position <= half
      ? position * 255 / half
      : (period - position) * 255 / half;
  }

  private static final class KingNationTitleScreen extends Screen {
    private KingNationTitleScreen() {
      super(Component.literal("KingNation"));
    }

    @Override
    protected void init() {
      int buttonWidth = Math.min(260, Math.max(220, this.width / 3));
      int primaryHeight = 30;
      int secondaryHeight = 24;
      int rowGap = 10;
      int secondaryGap = 10;
      int secondaryWidth = (buttonWidth - secondaryGap) / 2;
      int groupHeight = primaryHeight + rowGap + secondaryHeight;
      int x = (this.width - buttonWidth) / 2;
      int titleBottom = titleY(this.height) + titleHeight(this.width);
      int maxY = Math.max(24, this.height - groupHeight - 10);
      int y = Math.max(titleBottom + 22, (this.height - groupHeight) / 2 + 6);
      y = Math.min(y, maxY);

      this.addRenderableWidget(new KingNationButton(
        x,
        y,
        buttonWidth,
        primaryHeight,
        Component.literal("Jouer KingNation"),
        button -> connectToServer(),
        true
      ));

      this.addRenderableWidget(new KingNationButton(
        x,
        y + primaryHeight + rowGap,
        secondaryWidth,
        secondaryHeight,
        Component.literal("Options"),
        button -> this.minecraft.setScreen(new KingNationOptionsScreen(this)),
        false
      ));

      this.addRenderableWidget(new KingNationButton(
        x + secondaryWidth + secondaryGap,
        y + primaryHeight + rowGap,
        secondaryWidth,
        secondaryHeight,
        Component.literal("Quitter"),
        button -> this.minecraft.stop(),
        false
      ));
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderKingNationBackground(graphics, this.width, this.height);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderKingNationBackground(graphics, this.width, this.height);
      super.render(graphics, mouseX, mouseY, partialTick);
      renderTitle(graphics, this.width, this.height);
    }

    @Override
    public boolean isPauseScreen() {
      return false;
    }

    @Override
    public boolean shouldCloseOnEsc() {
      return false;
    }

    private void connectToServer() {
      KingNationMenuMod.connectToServer(this);
    }
  }

  private static final class KingNationConnectionFailedScreen extends Screen {
    private KingNationConnectionFailedScreen() {
      super(Component.literal("Connexion impossible"));
    }

    @Override
    protected void init() {
      int buttonWidth = Math.min(260, Math.max(220, this.width / 3));
      int buttonHeight = 24;
      int gap = 10;
      int x = (this.width - buttonWidth) / 2;
      int y = this.height / 2 + 36;

      this.addRenderableWidget(new KingNationButton(
        x,
        y,
        buttonWidth,
        buttonHeight,
        Component.literal("Reessayer"),
        button -> KingNationMenuMod.connectToServer(this),
        true
      ));

      this.addRenderableWidget(new KingNationButton(
        x,
        y + buttonHeight + gap,
        buttonWidth,
        buttonHeight,
        Component.literal("Retour au menu"),
        button -> this.minecraft.setScreen(new KingNationTitleScreen()),
        false
      ));
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderKingNationBackground(graphics, this.width, this.height);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderKingNationBackground(graphics, this.width, this.height);
      renderMessage(graphics);
      super.render(graphics, mouseX, mouseY, partialTick);
    }

    @Override
    public void onClose() {
      this.minecraft.setScreen(new KingNationTitleScreen());
    }

    @Override
    public boolean isPauseScreen() {
      return false;
    }

    private void renderMessage(GuiGraphics graphics) {
      int centerX = this.width / 2;
      int y = Math.max(72, this.height / 2 - 34);
      graphics.drawCenteredString(Minecraft.getInstance().font, Component.literal("Connexion impossible"), centerX, y, 0xFFFFFFFF);
      graphics.drawCenteredString(Minecraft.getInstance().font, Component.literal("Le serveur n'est pas encore disponible."), centerX, y + 22, 0xFFD8D8D8);
      graphics.drawCenteredString(Minecraft.getInstance().font, Component.literal("Reessayez plus tard."), centerX, y + 34, 0xFFB8B8B8);
      graphics.fill(centerX - 86, y + 14, centerX + 86, y + 15, 0xFFFF263C);
    }
  }

  private static final class KingNationPauseScreen extends Screen {
    private KingNationPauseScreen() {
      super(Component.literal("KingNation"));
    }

    @Override
    protected void init() {
      int buttonWidth = Math.min(220, Math.max(180, this.width / 4));
      int buttonHeight = 22;
      int gap = 8;
      int groupHeight = buttonHeight * 3 + gap * 2;
      int x = (this.width - buttonWidth) / 2;
      int panelHeight = pausePanelHeight(this.height);
      int panelY = pausePanelY(this.width, this.height, panelHeight);
      int y = panelY + (panelHeight - groupHeight) / 2;

      this.addRenderableWidget(new KingNationButton(
        x,
        y,
        buttonWidth,
        buttonHeight,
        Component.literal("Retour au jeu"),
        button -> onClose(),
        true
      ));

      this.addRenderableWidget(new KingNationButton(
        x,
        y + buttonHeight + gap,
        buttonWidth,
        buttonHeight,
        Component.literal("Options"),
        button -> this.minecraft.setScreen(new KingNationOptionsScreen(this)),
        false
      ));

      this.addRenderableWidget(new KingNationButton(
        x,
        y + (buttonHeight + gap) * 2,
        buttonWidth,
        buttonHeight,
        Component.literal("Retour au menu"),
        button -> this.minecraft.disconnect(new KingNationTitleScreen()),
        false
      ));
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderPauseBackdrop(graphics, partialTick);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderPauseBackdrop(graphics, partialTick);
      super.render(graphics, mouseX, mouseY, partialTick);
      renderPauseTitle(graphics, this.width, this.height);
    }

    @Override
    public void onClose() {
      this.minecraft.setScreen(null);
    }

    @Override
    public boolean isPauseScreen() {
      return true;
    }

    private void renderPauseBackdrop(GuiGraphics graphics, float partialTick) {
      this.renderBlurredBackground(partialTick);
      renderPauseGlassBackground(graphics, this.width, this.height);
    }
  }

  private static final class KingNationOptionsScreen extends Screen {
    private final Screen parent;

    private KingNationOptionsScreen(Screen parent) {
      super(Component.literal("Options KingNation"));
      this.parent = parent;
    }

    @Override
    protected void init() {
      Minecraft client = Minecraft.getInstance();
      int panelWidth = Math.min(360, Math.max(280, this.width / 2));
      int buttonHeight = 22;
      int gap = 8;
      int columnGap = 10;
      int columnWidth = (panelWidth - columnGap) / 2;
      int rows = 4;
      int groupHeight = rows * buttonHeight + (rows - 1) * gap;
      int x = (this.width - panelWidth) / 2;
      int y = Math.max(104, (this.height - groupHeight) / 2 + 24);

      addOptionButton(x, y, columnWidth, buttonHeight, "Graphismes", button -> this.minecraft.setScreen(new KingNationGraphicsScreen(this)));
      addOptionButton(x + columnWidth + columnGap, y, columnWidth, buttonHeight, "Sons", button -> this.minecraft.setScreen(new SoundOptionsScreen(this, client.options)));

      y += buttonHeight + gap;
      addOptionButton(x, y, columnWidth, buttonHeight, "Controles", button -> this.minecraft.setScreen(new ControlsScreen(this, client.options)));
      addOptionButton(x + columnWidth + columnGap, y, columnWidth, buttonHeight, "Chat", button -> this.minecraft.setScreen(new ChatOptionsScreen(this, client.options)));

      y += buttonHeight + gap;
      addOptionButton(x, y, columnWidth, buttonHeight, "Langue", button -> this.minecraft.setScreen(new LanguageSelectScreen(this, client.options, client.getLanguageManager())));
      addOptionButton(x + columnWidth + columnGap, y, columnWidth, buttonHeight, "Accessibilite", button -> this.minecraft.setScreen(new AccessibilityOptionsScreen(this, client.options)));

      y += buttonHeight + gap;
      addOptionButton(x, y, panelWidth, buttonHeight, "Retour", button -> onClose());
    }

    private void addOptionButton(int x, int y, int width, int height, String label, Button.OnPress onPress) {
      this.addRenderableWidget(new KingNationButton(x, y, width, height, Component.literal(label), onPress, false));
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderOptionsBackdrop(graphics, partialTick);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderOptionsBackdrop(graphics, partialTick);
      super.render(graphics, mouseX, mouseY, partialTick);
      KingNationMenuMod.renderOptionsHeader(graphics, this.width, this.height);
    }

    @Override
    public void onClose() {
      this.minecraft.setScreen(this.parent == null ? new KingNationTitleScreen() : this.parent);
    }

    @Override
    public boolean isPauseScreen() {
      return false;
    }

    private boolean usesInGameBackdrop() {
      return this.minecraft != null && this.minecraft.level != null;
    }

    private void renderOptionsBackdrop(GuiGraphics graphics, float partialTick) {
      if (!usesInGameBackdrop()) {
        renderKingNationBackground(graphics, this.width, this.height);
        return;
      }

      this.renderBlurredBackground(partialTick);
      graphics.fill(0, 0, this.width, this.height, 0x66000000);
      graphics.fillGradient(0, 0, this.width, this.height, 0x3303060C, 0x77000000);
      graphics.fill(0, 0, this.width, Math.max(24, this.height / 8), 0x24000000);
      renderAmbientMotion(graphics, this.width, this.height, true);
    }
  }

  private static final class KingNationGraphicsScreen extends Screen {
    private final Screen parent;

    private KingNationGraphicsScreen(Screen parent) {
      super(Component.literal("Graphismes KingNation"));
      this.parent = parent;
    }

    @Override
    protected void init() {
      Minecraft client = Minecraft.getInstance();
      boolean showShaders = hasIrisShaderPackScreen();
      boolean showDistantHorizons = hasDistantHorizonsConfigScreen();
      boolean showPhysics = hasPhysicsModConfigScreen();
      int panelWidth = Math.min(360, Math.max(280, this.width / 2));
      int buttonHeight = 22;
      int gap = 8;
      int columnGap = 10;
      int columnWidth = (panelWidth - columnGap) / 2;
      int rows = 4 + ((showDistantHorizons || showPhysics) ? 1 : 0);
      int groupHeight = rows * buttonHeight + (rows - 1) * gap;
      int x = (this.width - panelWidth) / 2;
      int y = Math.max(104, (this.height - groupHeight) / 2 + 24);

      this.addRenderableWidget(client.options.fov().createButton(client.options, x, y, panelWidth));

      y += buttonHeight + gap;
      addOptionButton(x, y, panelWidth, buttonHeight, "Parametres video", button -> this.minecraft.setScreen(new VideoSettingsScreen(this, client, client.options)));

      y += buttonHeight + gap;
      if (showShaders) {
        addOptionButton(x, y, columnWidth, buttonHeight, "Packs de ressources", button -> openResourcePackScreen(this));
        addOptionButton(x + columnWidth + columnGap, y, columnWidth, buttonHeight, "Packs de shaders", button -> openIrisShaderPackScreen(this));
      } else {
        addOptionButton(x, y, panelWidth, buttonHeight, "Packs de ressources", button -> openResourcePackScreen(this));
      }

      y += buttonHeight + gap;
      if (showDistantHorizons && showPhysics) {
        addOptionButton(x, y, columnWidth, buttonHeight, "Distant Horizons", button -> openDistantHorizonsConfig(this));
        addOptionButton(x + columnWidth + columnGap, y, columnWidth, buttonHeight, "Physics Mod Pro", button -> openPhysicsModConfig(this));
        y += buttonHeight + gap;
      } else if (showDistantHorizons) {
        addOptionButton(x, y, panelWidth, buttonHeight, "Distant Horizons", button -> openDistantHorizonsConfig(this));
        y += buttonHeight + gap;
      } else if (showPhysics) {
        addOptionButton(x, y, panelWidth, buttonHeight, "Physics Mod Pro", button -> openPhysicsModConfig(this));
        y += buttonHeight + gap;
      }

      addOptionButton(x, y, panelWidth, buttonHeight, "Retour", button -> onClose());
    }

    private void addOptionButton(int x, int y, int width, int height, String label, Button.OnPress onPress) {
      this.addRenderableWidget(new KingNationButton(x, y, width, height, Component.literal(label), onPress, false));
    }

    @Override
    public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderGraphicsBackdrop(graphics, partialTick);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      renderGraphicsBackdrop(graphics, partialTick);
      super.render(graphics, mouseX, mouseY, partialTick);
      KingNationMenuMod.renderOptionsHeader(graphics, this.width, this.height);
    }

    @Override
    public void onClose() {
      this.minecraft.setScreen(this.parent == null ? new KingNationOptionsScreen(null) : this.parent);
    }

    @Override
    public boolean isPauseScreen() {
      return false;
    }

    private boolean usesInGameBackdrop() {
      return this.minecraft != null && this.minecraft.level != null;
    }

    private void renderGraphicsBackdrop(GuiGraphics graphics, float partialTick) {
      if (!usesInGameBackdrop()) {
        renderKingNationBackground(graphics, this.width, this.height);
        return;
      }

      this.renderBlurredBackground(partialTick);
      graphics.fill(0, 0, this.width, this.height, 0x66000000);
      graphics.fillGradient(0, 0, this.width, this.height, 0x3303060C, 0x77000000);
      graphics.fill(0, 0, this.width, Math.max(24, this.height / 8), 0x24000000);
      renderAmbientMotion(graphics, this.width, this.height, true);
    }
  }

  private static final class KingNationButton extends Button {
    private final boolean primary;

    private KingNationButton(int x, int y, int width, int height, Component message, OnPress onPress, boolean primary) {
      super(x, y, width, height, message, onPress, DEFAULT_NARRATION);
      this.primary = primary;
    }

    @Override
    protected void renderWidget(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
      boolean hovered = this.active && this.isHovered();
      int border = this.active ? (hovered ? 0xFFFF3D57 : (this.primary ? 0xFFFF263C : 0xFF9E2638)) : 0xFF3A3A3A;
      int fillTop = this.active ? (hovered ? 0xFF2B0C16 : (this.primary ? 0xFF160B12 : 0xFF0B0E16)) : 0xFF1F1F1F;
      int fillBottom = this.active ? (hovered ? 0xFF4B0E1B : (this.primary ? 0xFF260812 : 0xFF150812)) : 0xFF151515;
      int text = this.active ? 0xFFFFFFFF : 0xFF9A9A9A;

      graphics.fill(this.getX() - 2, this.getY() - 2, this.getRight() + 2, this.getBottom() + 2, 0xFF020307);
      graphics.fill(this.getX() - 1, this.getY() - 1, this.getRight() + 1, this.getBottom() + 1, border);
      graphics.fillGradient(this.getX(), this.getY(), this.getRight(), this.getBottom(), fillTop, fillBottom);
      graphics.fill(this.getX() + 1, this.getY() + 1, this.getRight() - 1, this.getY() + 2, hovered ? 0x44FFFFFF : 0x22FFFFFF);
      graphics.fill(this.getX() + 1, this.getBottom() - 2, this.getRight() - 1, this.getBottom() - 1, this.primary ? 0x66FF263C : 0x449E2638);

      if (hovered) {
        graphics.fill(this.getX() + 5, this.getBottom() - 2, this.getRight() - 5, this.getBottom() - 1, argb(180, 255, 38, 60));
      }

      graphics.drawCenteredString(
        Minecraft.getInstance().font,
        this.getMessage(),
        this.getX() + this.getWidth() / 2,
        this.getY() + (this.getHeight() - 8) / 2,
        text
      );
    }
  }
}
